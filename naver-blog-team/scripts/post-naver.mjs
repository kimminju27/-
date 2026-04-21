/**
 * 네이버 블로그 자동 포스팅 (Playwright)
 * - SmartEditor ONE: 키보드 타이핑 방식 (React DOM 직접 조작 불가)
 * - 이미지 업로드: 툴바 사진 버튼 → file chooser
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DELAY = parseInt(process.env.POST_DELAY || '3000');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// HTML 태그 제거 → 순수 텍스트
function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<th[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 마크다운 표 → 텍스트
function tableToText(content) {
  return (content || '').split('\n')
    .filter(l => !l.trim().match(/^[\|\-\s]+$/))  // 구분선 제거
    .map(l => l.trim().startsWith('|') ? l.replace(/\|/g, ' ').trim() : l)
    .join('\n');
}

// ─────────────────────────────────────────
// 네이버 로그인
// ─────────────────────────────────────────
async function naverLogin(page) {
  const NAVER_ID = process.env.NAVER_ID;
  const NAVER_PASSWORD = process.env.NAVER_PASSWORD;
  if (!NAVER_ID || !NAVER_PASSWORD) throw new Error('NAVER_ID 또는 NAVER_PASSWORD가 .env에 없습니다.');

  console.log('   🔐 네이버 로그인 중...');
  await page.goto('https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com', {
    waitUntil: 'domcontentloaded',
  });
  await sleep(1500);

  await page.click('#id');
  await sleep(200);
  await page.keyboard.type(NAVER_ID, { delay: 80 });
  await sleep(400);

  await page.click('#pw');
  await sleep(200);
  await page.keyboard.type(NAVER_PASSWORD, { delay: 80 });
  await sleep(400);

  await page.click('#log\\.login');
  await sleep(3000);

  const currentUrl = page.url();
  if (currentUrl.includes('captcha') || currentUrl.includes('nidlogin')) {
    console.warn('\n⚠️  CAPTCHA 감지. 30초 내 수동 처리해주세요...');
    await sleep(30000);
    if (page.url().includes('nidlogin')) throw new Error('로그인 실패');
  }
  console.log('   ✅ 로그인 성공');
}

// ─────────────────────────────────────────
// 에디터 iframe 찾기 (SmartEditor ONE은 iframe 내부에서 동작)
// ─────────────────────────────────────────
async function getEditorFrame(page) {
  // 1) iframe 목록 순회
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const url = frame.url();
      // 에디터 관련 frame URL 패턴
      if (url.includes('PostWrite') || url.includes('se-editor') || url.includes('smarteditor') || url === 'about:blank') {
        const count = await frame.evaluate(() => {
          const els = document.querySelectorAll('[contenteditable="true"]');
          return Array.from(els).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && el.getAttribute('aria-hidden') !== 'true';
          }).length;
        }).catch(() => 0);
        if (count > 0) return frame;
      }
    } catch {}
  }
  // 2) 메인 페이지 자체 확인
  const mainCount = await page.evaluate(() => {
    const els = document.querySelectorAll('[contenteditable="true"]');
    return Array.from(els).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.getAttribute('aria-hidden') !== 'true';
    }).length;
  }).catch(() => 0);
  if (mainCount > 0) return page;
  return null;
}

// ─────────────────────────────────────────
// 팝업 처리 (이전 임시저장, 도움말 등)
// ─────────────────────────────────────────
async function dismissPopups(page) {
  // "작성 중인 글이 있습니다" → 취소 클릭 (새 글 시작)
  try {
    const popup = page.locator('.se-popup-alert-confirm, [data-name*="alert-confirm"]');
    if (await popup.isVisible({ timeout: 4000 })) {
      console.log('   ℹ️  임시저장 팝업 → 취소 클릭');
      await popup.locator('button').first().click();
      await sleep(1500);
    }
  } catch {}

  // 모든 frame에서 팝업 처리
  for (const frame of page.frames()) {
    try {
      const dismissed = await frame.evaluate(() => {
        // 취소/닫기 버튼 패턴
        const selectors = [
          '.se-popup-alert-confirm button',
          '[class*="popup"] button',
          '[class*="modal"] button',
          '[class*="help"] button[aria-label="닫기"]',
          '[class*="helpPanel"] .btn_close',
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            const txt = btn.textContent?.trim();
            // 취소/닫기만 클릭 (확인/등록은 건드리지 않음)
            if (!txt || txt === '취소' || txt === '닫기' || txt === '아니오' || btn.className?.includes('close')) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      }).catch(() => false);
      if (dismissed) await sleep(800);
    } catch {}
  }
}

// ─────────────────────────────────────────
// 제목 입력 (키보드 타이핑)
// ─────────────────────────────────────────
async function typeTitle(page, title) {
  console.log('   📌 제목 입력...');

  // 에디터가 로드될 때까지 대기 (최대 30초)
  let editorFrame = null;
  for (let i = 0; i < 30; i++) {
    editorFrame = await getEditorFrame(page);
    if (editorFrame) break;
    await sleep(1000);
  }

  if (!editorFrame) {
    // 최후 수단: 좌표 기반 클릭 (화면 상단 제목 영역)
    console.warn('   ⚠️  에디터 frame 탐색 실패 → 좌표 기반 클릭 시도');
    await page.mouse.click(640, 200);
    await sleep(500);
    await page.keyboard.type(title, { delay: 20 });
    return;
  }

  // 보이는 contenteditable 중 첫 번째 = 제목 영역
  const titleEl = await editorFrame.evaluateHandle(() => {
    const els = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    return els.find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.getAttribute('aria-hidden') !== 'true';
    }) || null;
  });

  const titleElem = titleEl.asElement();
  if (titleElem) {
    await titleElem.click({ force: true });
    await sleep(400);
    await page.keyboard.press('Control+a');
    await sleep(150);
    await page.keyboard.press('Delete');
    await sleep(150);
    await page.keyboard.type(title, { delay: 20 });
    await sleep(500);
    console.log('   ✅ 제목 입력 완료');
  } else {
    // data-placeholder로 제목 영역 찾기
    const byPlaceholder = await editorFrame.$('[data-placeholder*="제목"], [placeholder*="제목"]');
    if (byPlaceholder) {
      await byPlaceholder.click({ force: true });
      await sleep(300);
      await page.keyboard.type(title, { delay: 20 });
      await sleep(500);
      console.log('   ✅ 제목 입력 완료 (placeholder 방식)');
    } else {
      console.warn('   ⚠️  제목 입력란을 찾지 못했습니다. 좌표 클릭 시도...');
      await page.mouse.click(640, 200);
      await sleep(300);
      await page.keyboard.type(title, { delay: 20 });
    }
  }
}

// ─────────────────────────────────────────
// 이미지 업로드 (사진 버튼 클릭)
// ─────────────────────────────────────────
async function uploadImage(page, imagePath) {
  try {
    // 모든 frame에서 사진 버튼 탐색
    const selectors = [
      '.se-image-toolbar-button',
      'button[aria-label*="사진"]',
      'button[title*="사진"]',
      '[class*="toolbar"] button[aria-label*="image"]',
      '[data-action="insert-image"]',
    ];

    let photoBtn = null;
    let targetFrame = page;

    // 메인 페이지와 모든 frame 순서대로 탐색
    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
      for (const sel of selectors) {
        try {
          const btn = ctx.locator ? ctx.locator(sel).first() : null;
          if (btn && await btn.isVisible({ timeout: 1000 })) {
            photoBtn = btn;
            targetFrame = ctx;
            break;
          }
        } catch {}
      }
      if (photoBtn) break;
    }

    if (photoBtn) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        photoBtn.click(),
      ]);
      await fileChooser.setFiles(imagePath);
      await sleep(3000);
      console.log(`   🖼️  이미지 업로드: ${path.basename(imagePath)}`);
      return true;
    }
  } catch (e) {
    console.warn(`   ⚠️  이미지 업로드 실패: ${path.basename(imagePath)} — ${e.message}`);
  }
  return false;
}

// ─────────────────────────────────────────
// 본문 타이핑 (섹션별로 텍스트 + 이미지 교차)
// ─────────────────────────────────────────
async function typeContent(page, post) {
  console.log('   ✍️  본문 입력 중...');

  const cardPaths = post.cardPngPaths || [];

  // 에디터 frame 가져오기
  let editorFrame = await getEditorFrame(page);
  if (!editorFrame) editorFrame = page;

  // 본문 영역 클릭 (두 번째 contenteditable, 없으면 첫 번째)
  const bodyClicked = await editorFrame.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.getAttribute('aria-hidden') !== 'true';
    });
    const target = els[1] || els[0];
    if (target) { target.click(); target.focus(); return true; }
    return false;
  }).catch(() => false);

  if (!bodyClicked) {
    // 좌표 기반 클릭 (본문 영역 중앙)
    await page.mouse.click(640, 450);
  }
  await sleep(500);

  const sections = post.sections || [];

  for (const section of sections) {
    // 카드1: intro 전에 삽입
    if (section.id === 'intro' && cardPaths[0] && existsSync(cardPaths[0])) {
      await uploadImage(page, cardPaths[0]);
      await sleep(500);
    }

    // 소제목 입력
    if (section.heading) {
      await page.keyboard.type(section.heading, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(200);
    }

    // 본문 텍스트 입력 (HTML 태그 제거)
    const rawContent = tableToText(section.content || '');
    const plainText = stripHtml(rawContent);
    if (plainText) {
      await page.keyboard.type(plainText, { delay: 8 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(300);
    }

    // 섹션 뒤 카드 삽입
    if (section.id === 'facts' && cardPaths[1] && existsSync(cardPaths[1])) {
      await uploadImage(page, cardPaths[1]);
      await sleep(500);
    }
    if (section.id === 'detail' && cardPaths[2] && existsSync(cardPaths[2])) {
      await uploadImage(page, cardPaths[2]);
      await sleep(500);
    }
    if (section.id === 'outro' && cardPaths[3] && existsSync(cardPaths[3])) {
      await uploadImage(page, cardPaths[3]);
      await sleep(500);
    }
  }

  // 날짜 표시
  await page.keyboard.type(`\n${post.date} 기준 정보입니다.`, { delay: 10 });
  await sleep(500);

  console.log('   ✅ 본문 + 카드뉴스 삽입 완료');
}

// ─────────────────────────────────────────
// 태그 입력
// ─────────────────────────────────────────
async function insertTags(page, tags) {
  if (!tags?.length) return;
  try {
    const tagSelectors = [
      '[placeholder*="태그"]',
      'input[class*="tag"]',
      '[class*="tag_input"] input',
      '[class*="tagInput"] input',
    ];
    for (const selector of tagSelectors) {
      const tagInput = page.locator(selector).first();
      if (await tagInput.isVisible({ timeout: 2000 })) {
        for (const tag of tags.slice(0, 10)) {
          await tagInput.click();
          await tagInput.type(tag, { delay: 30 });
          await page.keyboard.press('Enter');
          await sleep(200);
        }
        console.log(`   🏷️  태그 입력 완료`);
        return;
      }
    }
  } catch {}
}

// ─────────────────────────────────────────
// 발행
// ─────────────────────────────────────────
async function publishPost(page) {
  console.log('   🚀 발행 버튼 클릭...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // JS로 직접 "발행" 버튼 찾아 클릭
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent?.trim() === '발행' || b.className?.includes('publish_btn'));
    if (btn) { btn.click(); return true; }
    return false;
  });

  if (!clicked) {
    console.warn('   ⚠️  발행 버튼을 찾지 못했습니다.');
    return false;
  }

  await sleep(3000);

  // 발행 확인 팝업 처리
  try {
    const confirmed = await page.evaluate(() => {
      const popups = Array.from(document.querySelectorAll('.se-popup, [class*="popup"], [class*="modal"]'));
      for (const p of popups) {
        if (p.offsetParent !== null) {
          const btns = Array.from(p.querySelectorAll('button'));
          const ok = btns.find(b => ['발행', '확인', '등록'].includes(b.textContent?.trim()));
          if (ok) { ok.click(); return true; }
        }
      }
      return false;
    });
    if (confirmed) await sleep(3000);
  } catch {}

  console.log('   ✅ 발행 완료');
  return true;
}

// ─────────────────────────────────────────
// 메인: 단일 포스트 발행
// ─────────────────────────────────────────
export async function postToNaver(post, browser) {
  const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID;
  if (!NAVER_BLOG_ID) throw new Error('NAVER_BLOG_ID가 .env에 없습니다.');

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  try {
    // 1. 로그인
    await naverLogin(page);
    await sleep(DELAY);

    // 2. 글쓰기 페이지 이동
    console.log('   📄 글쓰기 페이지 이동...');
    await page.goto(`https://blog.naver.com/PostWriteForm.naver?blogId=${NAVER_BLOG_ID}`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await sleep(5000);

    // 디버그 스크린샷 (팝업 처리 전)
    const ssPath = path.join(ROOT, 'drafts', `debug-${Date.now()}.png`);
    await page.screenshot({ path: ssPath });
    console.log(`   📸 스크린샷: ${path.basename(ssPath)}, URL: ${page.url()}`);

    // frame 목록 로그
    const frameUrls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
    console.log(`   🗂️  frames: ${frameUrls.length > 0 ? frameUrls.join(' | ') : '(없음)'}`);

    // 3. 팝업 처리
    await dismissPopups(page);
    await sleep(1000);

    // 4. 제목 입력
    await typeTitle(page, post.title);
    await sleep(500);

    // 5. 본문 + 카드뉴스 입력
    await typeContent(page, post);
    await sleep(1000);

    // 6. 태그
    await insertTags(page, post.tags);
    await sleep(500);

    // 7. 발행
    const published = await publishPost(page);
    await sleep(3000);

    const finalUrl = page.url();
    console.log(`   🌐 URL: ${finalUrl}`);

    await context.close();
    return { success: published, url: finalUrl };
  } catch (e) {
    try {
      const errPath = path.join(ROOT, 'drafts', `error-${Date.now()}.png`);
      await page.screenshot({ path: errPath });
    } catch {}
    await context.close();
    throw e;
  }
}

// ─────────────────────────────────────────
// 단독 실행
// ─────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // .env 로드
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }

  const draftFile = process.argv[2];
  if (!draftFile) {
    console.error('사용법: node scripts/post-naver.mjs drafts/FILENAME.json');
    process.exit(1);
  }

  const filepath = path.isAbsolute(draftFile) ? draftFile : path.join(ROOT, draftFile);
  if (!existsSync(filepath)) {
    console.error(`파일 없음: ${filepath}`);
    process.exit(1);
  }

  const post = JSON.parse(readFileSync(filepath, 'utf-8'));
  console.log(`\n🚀 포스팅 시작: ${post.title}`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const result = await postToNaver(post, browser);
    console.log(result.success ? '✅ 포스팅 완료' : '⚠️  발행 실패 (수동 확인 필요)');
  } finally {
    await browser.close();
  }
}
