/**
 * 네이버 블로그 임시저장 전용 스크립트 (Playwright)
 * - 카드뉴스 9장 모두 본문 앞에 업로드
 * - 발행(publish) 대신 임시저장(Ctrl+S)으로 저장
 *
 * 사용법:
 *   node scripts/post-naver-draft.mjs drafts/2026-03-23-주식-draft.json
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

function tableToText(content) {
  return (content || '').split('\n')
    .filter(l => !l.trim().match(/^[\|\-\s]+$/))
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
// 에디터 iframe 찾기
// ─────────────────────────────────────────
async function getEditorFrame(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const url = frame.url();
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
// 팝업 처리
// ─────────────────────────────────────────
async function dismissPopups(page) {
  try {
    const popup = page.locator('.se-popup-alert-confirm, [data-name*="alert-confirm"]');
    if (await popup.isVisible({ timeout: 4000 })) {
      console.log('   ℹ️  임시저장 팝업 → 취소 클릭');
      await popup.locator('button').first().click();
      await sleep(1500);
    }
  } catch {}

  for (const frame of page.frames()) {
    try {
      const dismissed = await frame.evaluate(() => {
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
// 제목 입력
// ─────────────────────────────────────────
async function typeTitle(page, title) {
  console.log('   📌 제목 입력...');

  let editorFrame = null;
  for (let i = 0; i < 30; i++) {
    editorFrame = await getEditorFrame(page);
    if (editorFrame) break;
    await sleep(1000);
  }

  if (!editorFrame) {
    console.warn('   ⚠️  에디터 frame 탐색 실패 → 좌표 기반 클릭 시도');
    await page.mouse.click(640, 200);
    await sleep(500);
    await page.keyboard.type(title, { delay: 20 });
    return;
  }

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
    const byPlaceholder = await editorFrame.$('[data-placeholder*="제목"], [placeholder*="제목"]');
    if (byPlaceholder) {
      await byPlaceholder.click({ force: true });
      await sleep(300);
      await page.keyboard.type(title, { delay: 20 });
      await sleep(500);
    } else {
      await page.mouse.click(640, 200);
      await sleep(300);
      await page.keyboard.type(title, { delay: 20 });
    }
  }
}

// ─────────────────────────────────────────
// 이미지 업로드
// ─────────────────────────────────────────
async function uploadImage(page, imagePath) {
  try {
    const selectors = [
      '.se-image-toolbar-button',
      'button[aria-label*="사진"]',
      'button[title*="사진"]',
      '[class*="toolbar"] button[aria-label*="image"]',
      '[data-action="insert-image"]',
    ];

    let photoBtn = null;
    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
      for (const sel of selectors) {
        try {
          const btn = ctx.locator ? ctx.locator(sel).first() : null;
          if (btn && await btn.isVisible({ timeout: 1000 })) {
            photoBtn = btn;
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
// 본문 입력 (섹션별 텍스트 + 관련 카드 교차 배치)
// ─────────────────────────────────────────
async function typeContent(page, post) {
  console.log('   ✍️  본문 입력 중 (카드 교차 배치)...');

  const cardPaths = post.cardPngPaths || [];

  let editorFrame = await getEditorFrame(page);
  if (!editorFrame) editorFrame = page;

  // 본문 영역 포커스
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
    await page.mouse.click(640, 450);
  }
  await sleep(500);

  const sections = post.sections || [];

  for (const section of sections) {
    // ── cover 섹션: 카드만 삽입 (텍스트 없음) ──
    if (section.id === 'cover') {
      const cardIdx = section.cardIndex ?? 0;
      const cardPath = cardPaths[cardIdx];
      if (cardPath && existsSync(cardPath)) {
        console.log(`   🖼️  표지 카드 삽입 (slide-0${cardIdx + 1})`);
        await uploadImage(page, cardPath);
        await page.keyboard.press('Enter');
        await sleep(500);
      }
      continue;
    }

    // ── 소제목 입력 ──
    if (section.heading) {
      await page.keyboard.type(section.heading, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(200);
    }

    // ── 본문 텍스트 입력 ──
    const rawContent = tableToText(section.content || '');
    const plainText = stripHtml(rawContent);
    if (plainText) {
      await page.keyboard.type(plainText, { delay: 8 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(300);
    }

    // ── 섹션에 지정된 카드 삽입 (텍스트 뒤) ──
    if (section.cardIndex != null) {
      const cardPath = cardPaths[section.cardIndex];
      if (cardPath && existsSync(cardPath)) {
        console.log(`   🖼️  카드 삽입: [${section.id}] → slide-${String(section.cardIndex + 1).padStart(2, '0')}`);
        await uploadImage(page, cardPath);
        await page.keyboard.press('Enter');
        await sleep(700);
      } else {
        console.warn(`   ⚠️  카드 이미지 없음 [${section.id}] index:${section.cardIndex} → ${cardPath}`);
      }
    }
  }

  // 날짜 표시
  await page.keyboard.type(`\n${post.date} 기준 정보입니다.`, { delay: 10 });
  await sleep(300);

  // 해시태그 본문 하단 삽입
  if (post.tags?.length) {
    const hashtagLine = '\n\n' + post.tags.map(t => `#${t}`).join(' ');
    await page.keyboard.type(hashtagLine, { delay: 5 });
    await sleep(300);
    console.log(`   🏷️  해시태그 ${post.tags.length}개 본문 하단 삽입 완료`);
  }

  console.log('   ✅ 본문 + 카드뉴스 교차 배치 완료');
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
// 임시저장 (발행 대신)
// ─────────────────────────────────────────
async function saveAsDraft(page) {
  console.log('   💾 임시저장 중...');

  // 방법 1: "임시저장" 버튼 직접 클릭 시도
  const savedByBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'));
    const btn = btns.find(b => {
      const txt = b.textContent?.trim();
      return txt === '임시저장' || txt?.includes('임시') || b.className?.includes('save') || b.getAttribute('title') === '임시저장';
    });
    if (btn) { btn.click(); return true; }
    return false;
  });

  if (savedByBtn) {
    console.log('   ✅ 임시저장 버튼 클릭 성공');
    await sleep(2000);
  } else {
    // 방법 2: Ctrl+S 단축키
    console.log('   ⌨️  Ctrl+S 임시저장 시도...');
    await page.keyboard.press('Control+s');
    await sleep(2000);

    // 임시저장 확인 팝업이 뜨면 처리
    try {
      const confirmed = await page.evaluate(() => {
        const popups = Array.from(document.querySelectorAll('.se-popup, [class*="popup"], [class*="modal"], [class*="dialog"]'));
        for (const p of popups) {
          if (p.offsetParent !== null) {
            const btns = Array.from(p.querySelectorAll('button'));
            const ok = btns.find(b => {
              const txt = b.textContent?.trim();
              return ['임시저장', '저장', '확인'].includes(txt);
            });
            if (ok) { ok.click(); return true; }
          }
        }
        return false;
      });
      if (confirmed) {
        console.log('   ✅ 임시저장 팝업 확인 완료');
        await sleep(2000);
      }
    } catch {}
  }

  // 방법 3: 모든 frame에서 임시저장 버튼 탐색
  if (!savedByBtn) {
    for (const frame of page.frames()) {
      try {
        const saved = await frame.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent?.trim() === '임시저장');
          if (btn && btn.offsetParent !== null) { btn.click(); return true; }
          return false;
        });
        if (saved) {
          console.log('   ✅ iframe에서 임시저장 버튼 발견 및 클릭');
          await sleep(2000);
          break;
        }
      } catch {}
    }
  }

  await sleep(1000);
  console.log('   ✅ 임시저장 완료');
  return true;
}

// ─────────────────────────────────────────
// 메인: 임시저장 포스팅
// ─────────────────────────────────────────
export async function postToNaverDraft(post, browser) {
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

    // 2. 글쓰기 페이지
    console.log('   📄 글쓰기 페이지 이동...');
    await page.goto(`https://blog.naver.com/PostWriteForm.naver?blogId=${NAVER_BLOG_ID}`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await sleep(5000);

    // 디버그 스크린샷
    const ssPath = path.join(ROOT, 'drafts', `debug-draft-${Date.now()}.png`);
    await page.screenshot({ path: ssPath });
    console.log(`   📸 스크린샷: ${path.basename(ssPath)}, URL: ${page.url()}`);

    const frameUrls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
    console.log(`   🗂️  frames: ${frameUrls.length > 0 ? frameUrls.join(' | ') : '(없음)'}`);

    // 3. 팝업 처리
    await dismissPopups(page);
    await sleep(1000);

    // 4. 제목 입력
    await typeTitle(page, post.title);
    await sleep(500);

    // 5. 카드뉴스 9장 + 본문 입력
    await typeContent(page, post);
    await sleep(1000);

    // 6. 태그
    await insertTags(page, post.tags);
    await sleep(500);

    // 7. 임시저장 (발행 아님!)
    await saveAsDraft(page);
    await sleep(3000);

    const finalUrl = page.url();
    console.log(`   🌐 URL: ${finalUrl}`);

    // 최종 스크린샷
    const finalSsPath = path.join(ROOT, 'drafts', `final-draft-${Date.now()}.png`);
    await page.screenshot({ path: finalSsPath });
    console.log(`   📸 최종 스크린샷: ${path.basename(finalSsPath)}`);

    await context.close();
    return { success: true, url: finalUrl };
  } catch (e) {
    try {
      const errPath = path.join(ROOT, 'drafts', `error-draft-${Date.now()}.png`);
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
    console.error('사용법: node scripts/post-naver-draft.mjs drafts/FILENAME.json');
    process.exit(1);
  }

  const filepath = path.isAbsolute(draftFile) ? draftFile : path.join(ROOT, draftFile);
  if (!existsSync(filepath)) {
    console.error(`파일 없음: ${filepath}`);
    process.exit(1);
  }

  const post = JSON.parse(readFileSync(filepath, 'utf-8'));
  console.log(`\n💾 임시저장 포스팅 시작: ${post.title}`);
  console.log(`   카드뉴스: ${post.cardPngPaths?.length || 0}장`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const result = await postToNaverDraft(post, browser);
    console.log(result.success ? '\n✅ 임시저장 완료! 네이버 블로그에서 확인하세요.' : '\n⚠️  저장 실패 (수동 확인 필요)');
  } finally {
    await browser.close();
  }
}
