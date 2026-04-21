/**
 * 티스토리 자동 포스팅 (Playwright)
 * - 카카오 계정 로그인
 * - 글쓰기 에디터: 제목 + 본문 + 태그 + 발행
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

// HTML + 마크다운 → 순수 텍스트
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
    // 마크다운 제거
    .replace(/^#{1,6}\s+/gm, '')        // ## 헤딩 제거
    .replace(/\*\*(.*?)\*\*/g, '$1')    // **bold**
    .replace(/\*(.*?)\*/g, '$1')        // *italic*
    .replace(/`(.*?)`/g, '$1')          // `code`
    .replace(/^[-*]\s+/gm, '• ')        // 리스트
    .replace(/^>\s+/gm, '')             // 인용문
    .replace(/- \[ \] /g, '• ')         // 체크리스트
    .replace(/- \[x\] /g, '✅ ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 마크다운 → Tistory 서식 HTML 변환
function convertMdToHtml(content) {
  if (!content) return '';
  const lines = content.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 마크다운 표 (헤더 | 구분선 | 데이터)
    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1]?.trim().match(/^\|?[\|\-\s]+\|?$/)) {
      let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;">';
      const headers = trimmed.split('|').map(c => c.trim()).filter(c => c);
      tableHtml += '<tr>' + headers.map(h => `<th style="background:#1a1a2e;color:#e63946;padding:12px;border:1px solid #ddd;text-align:center;font-weight:bold;">${h}</th>`).join('') + '</tr>';
      i += 2; // 헤더 + 구분선 건너뜀
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().split('|').map(c => c.trim()).filter(c => c);
        if (cells.length > 0) {
          tableHtml += '<tr>' + cells.map(c => `<td style="padding:10px;border:1px solid #ddd;text-align:center;color:#333;">${c}</td>`).join('') + '</tr>';
        }
        i++;
      }
      tableHtml += '</table>';
      html += tableHtml + '\n';
      continue;
    }

    // 빈 줄
    if (!trimmed) { html += '<br>\n'; i++; continue; }

    // 구분선
    if (trimmed.match(/^-{3,}$/) || trimmed.match(/^={3,}$/)) { i++; continue; }

    // 표 구분선만 있는 줄 건너뜀
    if (trimmed.match(/^[\|\-\s]+$/) && trimmed.includes('|')) { i++; continue; }

    // ### 소제목
    if (trimmed.startsWith('### ')) {
      html += `<h3 style="font-size:17px;font-weight:bold;color:#1a1a1a;margin:20px 0 10px;padding-left:12px;border-left:3px solid #e63946;">${trimmed.slice(4)}</h3>\n`;
      i++; continue;
    }

    // ## 소제목
    if (trimmed.startsWith('## ')) {
      html += `<h3 style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:24px 0 12px;padding-left:12px;border-left:3px solid #e63946;">${trimmed.slice(3)}</h3>\n`;
      i++; continue;
    }

    // 블록쿼트
    if (trimmed.startsWith('>')) {
      const quote = trimmed.replace(/^>\s*/, '');
      html += `<blockquote style="border-left:4px solid #e63946;padding:12px 16px;background:#fff5f5;color:#555;margin:16px 0;font-style:italic;">${quote}</blockquote>\n`;
      i++; continue;
    }

    // 불렛 포인트 (•, -, *)
    if (trimmed.startsWith('• ') || trimmed.match(/^[-*]\s+/)) {
      const text = trimmed.replace(/^[•\-\*]\s+/, '');
      const fmt = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
      html += `<p style="font-size:15px;line-height:1.8;color:#333;margin:4px 0 6px;padding-left:20px;">• ${fmt}</p>\n`;
      i++; continue;
    }

    // 표 데이터 줄 (이미 처리 안된 경우)
    if (trimmed.startsWith('|')) { i++; continue; }

    // 일반 단락
    const fmt = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    html += `<p style="font-size:16px;line-height:1.9;color:#333;margin:0 0 14px;">${fmt}</p>\n`;
    i++;
  }

  return html;
}

// ─────────────────────────────────────────
// PNG → Tistory CDN 업로드 (file chooser 방식)
// 에디터 툴바의 이미지 업로드 버튼을 클릭해서 파일 선택 후 CDN URL 획득
// ─────────────────────────────────────────

// 이미지 업로드 버튼 셀렉터 우선순위 목록
const IMG_BTN_SELECTORS = [
  // Tistory 커스텀 툴바
  'button[data-log*="image"], button[data-log*="img"]',
  'button[data-type="image"], button[data-type="img"]',
  'button[aria-label*="이미지 업로드"], button[title*="이미지 업로드"]',
  'button[aria-label*="사진 업로드"], button[title*="사진 업로드"]',
  '.tool_image button, .btn_image, .btn_img',
  '[class*="toolImage"] button, [class*="tool-image"] button',
  // TinyMCE 5 (tox) 툴바
  'button.tox-tbtn[aria-label*="이미지"]',
  'button.tox-tbtn[title*="이미지"]',
  'button.tox-tbtn[aria-label*="Image" i]',
  // 파일 인풋 직접
  'input[type="file"][accept*="image"]',
];

async function scanImageButtons(page) {
  return page.evaluate(() => {
    const els = document.querySelectorAll('button, input[type="file"], a[role="button"]');
    return Array.from(els)
      .filter(el => el.offsetParent !== null) // 보이는 것만
      .map(el => ({
        tag: el.tagName,
        id: el.id || '',
        type: el.getAttribute('type') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        dataLog: el.getAttribute('data-log') || '',
        dataType: el.getAttribute('data-type') || '',
        className: (el.className?.toString() || '').slice(0, 100),
        text: el.textContent?.trim().slice(0, 20) || '',
      }))
      .filter(el =>
        el.ariaLabel.includes('이미지') || el.title.includes('이미지') ||
        el.ariaLabel.includes('사진') || el.title.includes('사진') ||
        el.ariaLabel.toLowerCase().includes('image') || el.title.toLowerCase().includes('image') ||
        el.dataType.includes('image') || el.dataType.includes('img') ||
        el.dataLog.includes('image') || el.dataLog.includes('img') ||
        el.className.toLowerCase().includes('image') || el.className.toLowerCase().includes('img') ||
        el.text.includes('이미지') || el.text.includes('사진') ||
        el.type === 'file'
      );
  });
}

async function uploadImageToTistory(page, pngPath) {
  if (!existsSync(pngPath)) return null;
  try {
    // 1. 이미지 관련 버튼 스캔
    const imgBtns = await scanImageButtons(page);

    // 2. 기존 TinyMCE img 목록 스냅샷 (업로드 후 새로 추가된 것 감지용)
    const prevSrcs = await page.evaluate(() => {
      const ed = (typeof tinymce !== 'undefined') ? (tinymce.activeEditor || tinymce.editors?.[0]) : null;
      if (!ed) return [];
      return Array.from(ed.getBody()?.querySelectorAll('img') || []).map(i => i.src);
    });

    // 3. 버튼 클릭 + file chooser 시도
    for (const sel of IMG_BTN_SELECTORS) {
      const el = page.locator(sel).first();
      if (!await el.isVisible({ timeout: 800 }).catch(() => false)) continue;

      let uploaded = false;
      if (sel.includes('input[type="file"]')) {
        // 파일 인풋 직접 설정
        try {
          await el.setInputFiles(pngPath);
          uploaded = true;
        } catch {}
      } else {
        const fcPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
        await el.click({ force: true });
        const fc = await fcPromise;
        if (!fc) continue;
        await fc.setFiles(pngPath);
        uploaded = true;
      }

      if (!uploaded) continue;
      await sleep(4000); // 업로드 완료 대기

      // 새로 삽입된 img src 추출
      const newSrc = await page.evaluate((prev) => {
        const ed = (typeof tinymce !== 'undefined') ? (tinymce.activeEditor || tinymce.editors?.[0]) : null;
        if (!ed) return null;
        const imgs = Array.from(ed.getBody()?.querySelectorAll('img') || []);
        const newImgs = imgs.filter(i => i.src && !i.src.startsWith('data:') && !prev.includes(i.src));
        return newImgs[0]?.src || null;
      }, prevSrcs);

      if (newSrc) return newSrc;
    }

    // imgBtns 스캔 결과로 동적 셀렉터 시도
    for (const btn of imgBtns) {
      const sel = btn.id ? `#${btn.id}` :
                  btn.ariaLabel ? `[aria-label="${btn.ariaLabel}"]` :
                  btn.type === 'file' ? `input[type="file"]` : null;
      if (!sel) continue;

      const el = page.locator(sel).first();
      if (!await el.isVisible({ timeout: 500 }).catch(() => false)) continue;

      const fcPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
      await el.click({ force: true });
      const fc = await fcPromise;
      if (!fc) continue;
      await fc.setFiles(pngPath);
      await sleep(4000);

      const newSrc = await page.evaluate((prev) => {
        const ed = (typeof tinymce !== 'undefined') ? (tinymce.activeEditor || tinymce.editors?.[0]) : null;
        if (!ed) return null;
        const imgs = Array.from(ed.getBody()?.querySelectorAll('img') || []);
        return imgs.find(i => i.src && !i.src.startsWith('data:') && !prev.includes(i.src))?.src || null;
      }, prevSrcs);

      if (newSrc) return newSrc;
    }

    return null;
  } catch { return null; }
}

// 카드 이미지 HTML 블록 (src = CDN URL 또는 base64 fallback)
function cardImgHtml(src, alt = '카드뉴스') {
  if (!src) return '';
  return `<div style="text-align:center;margin:24px 0 16px;">` +
         `<img src="${src}" style="max-width:100%;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.1);" alt="${alt}">` +
         `</div>\n`;
}

// Tistory 포스트용 HTML 빌드 (업로드된 CDN URL 우선, fallback = base64)
function buildTistoryHtml(post, uploadedUrls = []) {
  const sections = post.sections || [];
  const cardPaths = post.cardPngPaths || [];

  // CDN URL이 있으면 우선 사용, 없으면 base64 fallback
  const cards = cardPaths.map((p, i) => {
    if (uploadedUrls[i]) return uploadedUrls[i];
    if (existsSync(p)) {
      const data = readFileSync(p);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
    return null;
  });

  let html = '';

  for (const section of sections) {
    const content = section.content || '';

    // 지시문 플레이스홀더는 건너뜀
    if (content.startsWith('[실제 ') || content.startsWith('[실전 ') || content.startsWith('[진솔한')) {
      continue;
    }

    // intro 앞: 카드1 (Hero 카드)
    if (section.id === 'intro' && cards[0]) {
      html += cardImgHtml(cards[0], post.title + ' 카드뉴스 1');
    }

    if (section.heading) {
      const cleanHeading = section.heading
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\[실제 소제목:.*?\]/, '')
        .trim();
      if (cleanHeading) {
        html += `<h2 style="font-size:20px;font-weight:bold;color:#1a1a1a;border-left:5px solid #e63946;padding-left:14px;margin:32px 0 14px;">${cleanHeading}</h2>\n`;
      }
    }

    html += convertMdToHtml(content);
    html += '<br>\n';

    // 섹션 뒤: 카드 삽입
    if (section.id === 'facts' && cards[1]) {
      html += cardImgHtml(cards[1], '핵심 비교 카드뉴스');
    }
    if (section.id === 'detail' && cards[2]) {
      html += cardImgHtml(cards[2], '액션 가이드 카드뉴스');
    }
    if (section.id === 'outro' && cards[3]) {
      html += cardImgHtml(cards[3], '핵심 데이터 카드뉴스');
    }
  }

  html += `<hr style="border:none;border-top:1px solid #eee;margin:32px 0;">\n`;
  html += `<p style="font-size:13px;color:#999;text-align:right;">${post.date} 기준 정보입니다.</p>\n`;
  return html;
}

// ─────────────────────────────────────────
// 카카오 로그인
// ─────────────────────────────────────────
async function tistoryLogin(page) {
  const KAKAO_ID = process.env.KAKAO_ID;
  const KAKAO_PASSWORD = process.env.KAKAO_PASSWORD;
  const BLOG_NAME = process.env.TISTORY_BLOG_NAME;
  if (!KAKAO_ID || !KAKAO_PASSWORD) throw new Error('KAKAO_ID 또는 KAKAO_PASSWORD가 .env에 없습니다.');

  console.log('   🔐 티스토리(카카오) 로그인 중...');
  await page.goto('https://www.tistory.com/auth/login', { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // 카카오 로그인 버튼 클릭
  const kakaoBtn = page.locator('a.link_kakao_id, a:has-text("카카오계정으로 로그인")').first();
  if (await kakaoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      kakaoBtn.click({ force: true }),
    ]);
    await sleep(2000);
  }

  // accounts.kakao.com 에서 이메일/비밀번호 입력
  const emailInput = page.locator('#loginId, input[name="loginId"]').first();
  if (await emailInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await emailInput.fill(KAKAO_ID);
    await sleep(300);
    await page.locator('#password, input[name="password"]').first().fill(KAKAO_PASSWORD);
    await sleep(300);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      page.locator('button[type="submit"]').first().click(),
    ]);
    await sleep(3000);
  }

  // 2단계 인증 또는 추가 처리 대기 (최대 90초)
  console.log(`   🌐 현재 URL: ${page.url()}`);
  if (!page.url().includes('tistory.com') || page.url().includes('login')) {
    console.warn('   ⚠️  2단계 인증 필요 — 브라우저에서 직접 처리해주세요 (최대 90초)');
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const url = page.url();
      if (url.includes('tistory.com') && !url.includes('login') && !url.includes('auth')) break;
    }
  }

  // 블로그 관리 페이지로 이동해서 서브도메인 세션 확립
  await page.goto(`https://${BLOG_NAME}.tistory.com/manage`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const finalUrl = page.url();
  console.log(`   🌐 관리 페이지: ${finalUrl}`);

  if (finalUrl.includes('login') || finalUrl.includes('auth/')) {
    throw new Error('로그인 실패 — 세션이 서브도메인에 전달되지 않았습니다');
  }

  console.log('   ✅ 로그인 성공');
}

// ─────────────────────────────────────────
// 제목 입력
// ─────────────────────────────────────────
async function typeTitle(page, title) {
  console.log('   📌 제목 입력...');

  // 티스토리 제목 textarea: #post-title-inp (확인된 셀렉터)
  const titleSelectors = [
    '#post-title-inp',
    'textarea.textarea_tit',
    '[placeholder="제목을 입력하세요"]',
    '[placeholder*="제목"]',
    '[data-placeholder*="제목"]',
  ];

  for (const sel of titleSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        // textarea는 fill() 사용 (가장 안정적)
        await el.click({ force: true });
        await sleep(200);
        await el.fill(title);
        await sleep(300);
        console.log(`   ✅ 제목 입력 완료 (셀렉터: ${sel})`);
        return;
      }
    } catch {}
  }
  console.warn('   ⚠️  제목 입력란 못 찾음');
}

// ─────────────────────────────────────────
// 본문 입력 (서식 있는 HTML 그대로 TinyMCE에 삽입)
// ─────────────────────────────────────────
async function typeContent(page, post) {
  console.log('   ✍️  본문 입력 중...');

  // 카드 이미지를 Tistory CDN에 업로드 시도
  const cardPaths = post.cardPngPaths || [];
  const uploadedUrls = [];
  if (cardPaths.length > 0) {
    // 이미지 관련 버튼 사전 스캔 (디버그)
    const imgBtnList = await scanImageButtons(page);
    if (imgBtnList.length > 0) {
      console.log('   🔍 이미지 버튼 스캔:', JSON.stringify(imgBtnList.slice(0, 5)));
    } else {
      console.log('   🔍 이미지 버튼 없음 (base64 fallback 예정)');
    }

    console.log('   📤 카드 이미지 업로드 시도...');
    for (let i = 0; i < cardPaths.length; i++) {
      const url = await uploadImageToTistory(page, cardPaths[i]);
      uploadedUrls.push(url || null);
      if (url) console.log(`   ✅ 카드${i + 1} 업로드: ${url}`);
      else console.log(`   ⚠️  카드${i + 1} 업로드 실패 → base64 fallback`);
    }
  }

  // 서식 있는 HTML 빌드 (CDN URL 우선)
  const htmlContent = buildTistoryHtml(post, uploadedUrls);

  // 1순위: TinyMCE API (window.tinymce)
  const tinyOk = await page.evaluate((html) => {
    try {
      if (typeof tinymce !== 'undefined') {
        const ed = tinymce.activeEditor || tinymce.editors?.[0];
        if (ed) { ed.setContent(html); ed.save(); return 'tinymce-api'; }
      }
    } catch {}
    return null;
  }, htmlContent);

  if (tinyOk) {
    console.log(`   ✅ TinyMCE API 삽입 완료`);
    await sleep(800);
  } else {
    // 2순위: TinyMCE iframe 탐색
    console.log('   🔀 TinyMCE iframe 탐색...');
    let editorFrame = null;
    for (const frame of page.frames()) {
      const isEditor = await frame.evaluate(() => {
        return document.body?.id === 'tinymce' ||
               document.body?.getAttribute('contenteditable') === 'true';
      }).catch(() => false);
      if (isEditor) { editorFrame = frame; break; }
    }

    if (editorFrame) {
      await editorFrame.evaluate((html) => {
        if (document.body) {
          document.body.innerHTML = html;
          document.body.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, htmlContent);
      await sleep(500);
      await page.evaluate(() => {
        if (typeof tinymce !== 'undefined') {
          const ed = tinymce.activeEditor || tinymce.editors?.[0];
          if (ed) ed.save();
        }
      });
      console.log('   ✅ TinyMCE iframe HTML 삽입 완료');
      await sleep(500);
    } else {
      // 3순위: contenteditable body 직접 탐색
      const ceOk = await page.evaluate((html) => {
        // 에디터 안의 contenteditable 영역 찾기
        const candidates = document.querySelectorAll('[contenteditable="true"]');
        for (const el of candidates) {
          // 제목 영역 제외 (data-placeholder에 "제목" 포함)
          const ph = el.getAttribute('data-placeholder') || '';
          if (ph.includes('제목')) continue;
          el.focus();
          el.innerHTML = html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      }, htmlContent);

      if (ceOk) {
        console.log('   ✅ contenteditable 직접 삽입');
      } else {
        console.warn('   ⚠️  본문 에디터를 찾지 못했습니다');
      }
      await sleep(500);
    }
  }

  const cdnCount = uploadedUrls.filter(Boolean).length;
  const fallbackCount = (post.cardPngPaths || []).length - cdnCount;
  if (cdnCount > 0) console.log(`   🖼️  카드뉴스 ${cdnCount}장 CDN 업로드 성공`);
  if (fallbackCount > 0) console.log(`   🖼️  카드뉴스 ${fallbackCount}장 base64 fallback`);

  console.log('   ✅ 본문 입력 완료');
  return uploadedUrls;
}

// ─────────────────────────────────────────
// 태그 입력
// ─────────────────────────────────────────
async function insertTags(page, tags) {
  if (!tags?.length) return;
  try {
    const selectors = [
      '#tagText',
      'input[placeholder*="태그"]',
      '.tag-input input',
      '[class*="tag"] input',
    ];
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        for (const tag of tags.slice(0, 10)) {
          await el.click();
          await el.type(tag, { delay: 30 });
          await page.keyboard.press('Enter');
          await sleep(200);
        }
        console.log('   🏷️  태그 입력 완료');
        return;
      }
    }
  } catch {}
}

// ─────────────────────────────────────────
// 대표 이미지(썸네일) 설정
// ─────────────────────────────────────────
async function setThumbnail(page, pngPath, uploadedUrl) {
  if (!pngPath && !uploadedUrl) return;
  console.log('   🖼️  대표 이미지 설정 시도...');
  try {
    // 발행 패널이 열려 있을 때 대표 이미지 설정 UI 탐색
    const thumbSelectors = [
      '[data-role="thumbnail"]',
      '.thumbnail-area button',
      'button:has-text("대표 이미지")',
      'button[aria-label*="대표 이미지"]',
      '.btn-thumb-setting',
      '#thumbnail-image-btn',
    ];

    for (const sel of thumbSelectors) {
      const el = page.locator(sel).first();
      if (!await el.isVisible({ timeout: 1500 }).catch(() => false)) continue;

      if (uploadedUrl) {
        // CDN URL을 직접 대표 이미지 src에 주입
        await page.evaluate((url) => {
          const inputs = document.querySelectorAll('input[name*="thumb"], input[id*="thumb"], input[name*="representative"]');
          for (const inp of inputs) { inp.value = url; inp.dispatchEvent(new Event('change', { bubbles: true })); }
        }, uploadedUrl);
        console.log('   ✅ 대표 이미지 URL 설정 완료');
        return;
      } else if (pngPath && existsSync(pngPath)) {
        // 파일 선택 방식
        const fcPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
        await el.click({ force: true });
        const fc = await fcPromise;
        if (fc) {
          await fc.setFiles(pngPath);
          await sleep(2000);
          console.log('   ✅ 대표 이미지 파일 업로드 완료');
          return;
        }
      }
      break;
    }

    // 대표 이미지 버튼이 없으면 포스트 내 첫 번째 이미지가 자동 사용됨
    console.log('   ℹ️  대표 이미지 UI 없음 → 포스트 내 첫 이미지 자동 사용');
  } catch (e) {
    console.warn('   ⚠️  대표 이미지 설정 실패:', e.message);
  }
}

// ─────────────────────────────────────────
// 발행
// ─────────────────────────────────────────
async function publishPost(page, thumbnailPngPath, thumbnailUrl) {
  console.log('   🚀 발행 버튼 클릭...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // 완료 or 발행 버튼
  const btnSelectors = [
    'button.btn_publish',
    'button[data-ke-type="button"]:has-text("완료")',
    'button:has-text("발행")',
    'button:has-text("완료")',
    '.publish-btn',
    '#publish-layer-btn',
  ];

  for (const sel of btnSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await sleep(2000);
      break;
    }
  }

  // 발행 패널이 열리면 대표 이미지 설정 시도
  await setThumbnail(page, thumbnailPngPath, thumbnailUrl);
  await sleep(500);

  // 발행 확인 팝업 처리 (공개 발행 버튼)
  try {
    const confirmSelectors = [
      'button:has-text("발행")',
      'button:has-text("공개")',
      '.btn_ok',
      '.layer_btn_publish button',
    ];
    for (const sel of confirmSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await sleep(3000);
        break;
      }
    }
  } catch {}

  console.log('   ✅ 발행 완료');
  return true;
}

// ─────────────────────────────────────────
// 임시저장
// ─────────────────────────────────────────
async function saveDraftPost(page) {
  console.log('   💾 임시저장 중...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // Ctrl+S 단축키 시도
  await page.keyboard.press('Control+s');
  await sleep(1500);

  // 임시저장 버튼 셀렉터
  const draftSelectors = [
    'button:has-text("임시저장")',
    'button[aria-label*="임시저장"]',
    '#btn-save-temp',
    '.btn_save_temp',
    'button.btn_temp',
    'a:has-text("임시저장")',
  ];

  for (const sel of draftSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await sleep(2000);
      console.log(`   ✅ 임시저장 완료 (셀렉터: ${sel})`);
      return true;
    }
  }

  // 임시저장 버튼이 없으면 Ctrl+S로만 저장된 것으로 간주
  console.log('   ✅ 임시저장 완료 (Ctrl+S)');
  return true;
}

// ─────────────────────────────────────────
// 메인: 단일 포스트 발행
// ─────────────────────────────────────────
const SESSION_FILE = path.join(ROOT, 'drafts', 'tistory-session.json');

export async function postToTistory(post, browser, { draft = false } = {}) {
  const TISTORY_BLOG_NAME = process.env.TISTORY_BLOG_NAME;
  if (!TISTORY_BLOG_NAME) throw new Error('TISTORY_BLOG_NAME이 .env에 없습니다.');

  // 저장된 세션 있으면 재사용
  const sessionExists = existsSync(SESSION_FILE);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    ...(sessionExists ? { storageState: SESSION_FILE } : {}),
  });
  if (sessionExists) console.log('   🍪 저장된 세션 로드됨');

  const page = await context.newPage();

  try {
    // 1. 로그인 (세션 없을 때만)
    if (!sessionExists) {
      await tistoryLogin(page);
      // 세션 저장
      await context.storageState({ path: SESSION_FILE });
      console.log('   💾 세션 저장 완료');
    } else {
      // 세션 유효 확인 — 서브도메인 관리 페이지로 직접 체크
      await page.goto(`https://${TISTORY_BLOG_NAME}.tistory.com/manage`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      const checkUrl = page.url();
      if (checkUrl.includes('login') || checkUrl.includes('auth') || checkUrl.includes('tistory.com/auth')) {
        console.log('   ⚠️  세션 만료 → 재로그인');
        await tistoryLogin(page);
        await context.storageState({ path: SESSION_FILE });
        console.log('   💾 세션 재저장 완료');
      } else {
        console.log('   ✅ 세션 유효');
      }
    }
    await sleep(DELAY);

    // 2. 글쓰기 페이지 이동 (관리 페이지 → 글쓰기 버튼)
    console.log('   📄 글쓰기 페이지 이동...');
    await page.goto(`https://${TISTORY_BLOG_NAME}.tistory.com/manage`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await sleep(3000);

    // 글쓰기 버튼 클릭
    const writeBtn = page.locator('a:has-text("글쓰기"), a[href*="post/write"], button:has-text("글쓰기"), .btn_write, #btnWrite').first();
    if (await writeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
        writeBtn.click(),
      ]);
    } else {
      // 직접 URL 시도
      await page.goto(`https://${TISTORY_BLOG_NAME}.tistory.com/manage/post/write`, {
        waitUntil: 'networkidle', timeout: 30000,
      });
    }
    await sleep(6000);

    // 디버그 스크린샷
    const ssPath = path.join(ROOT, 'drafts', `tistory-debug-${Date.now()}.png`);
    await page.screenshot({ path: ssPath, fullPage: true });
    console.log(`   📸 스크린샷: ${ssPath}`);

    // 페이지 DOM 구조 상세 로그
    const allElements = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('input, textarea, [contenteditable]').forEach(el => {
        result.push({
          tag: el.tagName,
          id: el.id || '',
          className: (el.className?.toString() || '').slice(0, 100),
          placeholder: el.getAttribute('placeholder') || '',
          dataPlaceholder: el.getAttribute('data-placeholder') || '',
          contenteditable: el.getAttribute('contenteditable') || '',
          visible: el.offsetParent !== null,
        });
      });
      return result;
    });
    console.log('   🔍 에디터 요소:', JSON.stringify(allElements, null, 2));

    // iframe 목록 로그
    const iframes = page.frames().map(f => f.url());
    console.log('   🖼️  iframe 목록:', JSON.stringify(iframes));

    // 3. 제목 입력
    await typeTitle(page, post.title);
    await sleep(500);

    // 4. 본문 입력 (업로드된 CDN URL 반환받기)
    const uploadedUrls = await typeContent(page, post);
    await sleep(1000);

    // 5. 태그
    await insertTags(page, post.tags);
    await sleep(500);

    // 6. 발행 or 임시저장 (썸네일 = 카드1 CDN URL 또는 PNG 경로)
    const thumbUrl = uploadedUrls?.[0] || null;
    const thumbPath = post.cardPngPaths?.[0] || null;
    const published = draft
      ? await saveDraftPost(page)
      : await publishPost(page, thumbPath, thumbUrl);
    await sleep(3000);

    const finalUrl = page.url();
    console.log(`   🌐 URL: ${finalUrl}`);

    await context.close();
    return { success: published, url: finalUrl };
  } catch (e) {
    try {
      const errPath = path.join(ROOT, 'drafts', `tistory-error-${Date.now()}.png`);
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
    console.error('사용법: node scripts/post-tistory.mjs drafts/FILENAME.json');
    process.exit(1);
  }

  const filepath = path.isAbsolute(draftFile) ? draftFile : path.join(ROOT, draftFile);
  if (!existsSync(filepath)) {
    console.error(`파일 없음: ${filepath}`);
    process.exit(1);
  }

  const post = JSON.parse(readFileSync(filepath, 'utf-8'));
  console.log(`\n🚀 티스토리 포스팅 시작: ${post.title}`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const result = await postToTistory(post, browser);
    console.log(result.success ? '✅ 포스팅 완료' : '⚠️  발행 실패 (수동 확인 필요)');
  } finally {
    await browser.close();
  }
}
