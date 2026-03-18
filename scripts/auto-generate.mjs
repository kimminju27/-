/**
 * 자동 글 생성 스크립트
 * - news 모드: Google News RSS → Claude API → 뉴스 기사 HTML 생성
 * - product_review 모드: 제품 URL → Claude API → 리뷰 HTML 생성
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODE = process.env.GENERATION_MODE || 'news';
const CATEGORIES_TO_RUN = (process.env.CATEGORIES || '경제,주식').split(',').map(s => s.trim()).filter(Boolean);
const PRODUCT_LINKS_RAW = process.env.PRODUCT_LINKS || '';

// ─────────────────────────────────────────
// 1. 뉴스 RSS 가져오기 (Google News, 무료)
// ─────────────────────────────────────────
const NEWS_QUERIES = {
  '경제': '한국 경제 금리 물가 환율',
  '부동산': '부동산 아파트 전세 청약 집값',
  '주식': '주식 코스피 코스닥 ETF 투자',
  '복지정책': '정부 복지 지원금 청년혜택 정책',
};

async function fetchNewsRSS(category) {
  const q = encodeURIComponent(NEWS_QUERIES[category] || category);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    const xml = await res.text();

    const items = [];
    for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6)) {
      const t = m[1];
      const title = (t.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || t.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
      const desc = (t.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || t.match(/<description>(.*?)<\/description>/))?.[1]
        ?.replace(/<[^>]*>/g, '').trim().substring(0, 250) || '';
      if (title.length > 5) items.push({ title, desc });
    }
    return items;
  } catch (e) {
    console.warn(`RSS 가져오기 실패 (${category}):`, e.message);
    return [];
  }
}

// ─────────────────────────────────────────
// 2. 뉴스 기사 생성
// ─────────────────────────────────────────
async function generateNewsArticle(category) {
  console.log(`\n📰 뉴스 기사 생성 중: [${category}]`);

  const newsItems = await fetchNewsRSS(category);
  const newsContext = newsItems.length > 0
    ? newsItems.map((n, i) => `${i + 1}. ${n.title}\n   ${n.desc}`).join('\n\n')
    : `${category} 관련 최신 동향`;

  const today = getKSTDate();

  const prompt = `당신은 한국 경제 블로그 전문 작가입니다. 아래 최신 뉴스를 바탕으로 "${category}" 카테고리의 SEO 최적화 블로그 글을 작성해주세요.

오늘 날짜: ${today}

최신 뉴스:
${newsContext}

다음 JSON 형식으로만 응답하세요 (코드블록 없이 순수 JSON):
{
  "title": "SEO 최적화된 글 제목 (45-65자, 핵심 키워드 포함)",
  "description": "메타 설명 (80-120자, 핵심 내용 요약)",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "slug": "영문-url-슬러그-짧게",
  "heroGradient": "linear-gradient(135deg, #0f172a, #1e3a5f)",
  "heroEmoji": "💰",
  "heroTag": "경제 · ${today}",
  "heroStats": [
    {"label": "핵심 수치 레이블", "value": "수치", "color": "#f87171"},
    {"label": "레이블2", "value": "수치2", "color": "#fbbf24"}
  ],
  "heroSubtext": "한 줄 요약 문구",
  "intro": "<p>도입부 첫 문단</p><p>도입부 두 번째 문단 (독자 공감 유도)</p>",
  "cards": [
    {
      "num": "01",
      "badge": "배지 텍스트",
      "title": "카드 제목",
      "body": "카드 본문 (2-3문장, 구체적 수치 포함)",
      "stat": "임팩트 수치/문구",
      "statColor": "#f87171",
      "bg": "linear-gradient(135deg, #0f172a, #1e3a5f)"
    }
  ],
  "sections": [
    {
      "id": "section1",
      "heading": "섹션 제목 (이모지 포함)",
      "content": "<p>본문 내용...</p><p>추가 내용...</p>"
    }
  ],
  "summary": ["핵심 요약 포인트1", "핵심 요약 포인트2", "핵심 요약 포인트3"],
  "readMinutes": 5
}

규칙:
- cards는 3-5개 (각각 관련 section 직전에 배치됨)
- sections는 4-6개
- content는 HTML 가능 (p, ul, li, strong, blockquote, table 등)
- 실제 수치, 구체적 정보, 독자에게 유용한 내용 위주
- 구어체, 친근한 톤으로 작성`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON을 찾을 수 없습니다');

  const data = JSON.parse(jsonMatch[0]);
  data.category = category;
  data.date = today;

  // slug 중복 방지: 날짜 suffix 추가
  if (!data.slug) data.slug = `${category}-${today}`;
  data.slug = sanitizeSlug(data.slug) + '-' + today;

  return data;
}

// ─────────────────────────────────────────
// 3. 제품 리뷰 생성
// ─────────────────────────────────────────
async function fetchProductInfo(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const html = await res.text();

    const getOg = (prop) =>
      html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]+)"`))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="og:${prop}"`))?.[1] || '';

    return {
      title: getOg('title'),
      image: getOg('image'),
      description: getOg('description'),
      url,
    };
  } catch (e) {
    console.warn('제품 페이지 가져오기 실패:', e.message);
    return { title: '', image: '', description: '', url };
  }
}

async function generateProductReview(productUrl, platform = 'coupang') {
  console.log(`\n📦 제품 리뷰 생성 중: ${productUrl}`);

  const info = await fetchProductInfo(productUrl);
  const today = getKSTDate();

  const disclaimer = platform === 'coupang'
    ? '이 포스팅은 쿠팡 파트너스 활동의 일환으로 이에 따른 일정액의 수수료를 제공받습니다.'
    : '본 포스팅은 네이버 쇼핑커넥트의 일환으로 판매시 수수료를 지급받을 수 있습니다.';

  const prompt = `당신은 제품 리뷰 전문 블로거입니다. 아래 제품에 대한 상세한 구매 가이드 겸 리뷰 글을 작성해주세요.

제품 URL: ${productUrl}
제품명: ${info.title || '제품 정보 미확인'}
제품 설명: ${info.description || ''}
플랫폼: ${platform === 'coupang' ? '쿠팡' : '네이버'}

다음 JSON 형식으로만 응답하세요 (코드블록 없이 순수 JSON):
{
  "title": "제품명 포함 SEO 리뷰 제목 (50-70자)",
  "productName": "제품명",
  "description": "메타 설명 (80-120자)",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "slug": "product-review-영문-슬러그",
  "intro": "<p>도입부 첫 문단</p><p>도입부 두 번째 문단</p>",
  "pros": ["장점1", "장점2", "장점3", "장점4", "장점5"],
  "cons": ["단점1", "단점2", "단점3"],
  "specs": [
    {"label": "스펙 항목", "value": "값"}
  ],
  "sections": [
    {
      "heading": "섹션 제목",
      "content": "<p>내용...</p>"
    }
  ],
  "rating": 4.2,
  "summary": ["추천 포인트1", "추천 포인트2", "추천 포인트3"],
  "targetUser": "이런 분께 추천합니다: ...",
  "readMinutes": 4
}

규칙:
- 실제 제품 특성에 맞는 구체적인 내용
- sections는 3-4개
- 솔직한 장단점 분석`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON을 찾을 수 없습니다');

  const data = JSON.parse(jsonMatch[0]);
  data.category = '제품리뷰';
  data.date = today;
  data.platform = platform;
  data.disclaimer = disclaimer;
  data.affiliateUrl = productUrl;
  data.productImage = info.image;

  if (!data.slug) data.slug = `review-${today}`;
  data.slug = sanitizeSlug(data.slug) + '-' + today;

  return data;
}

// ─────────────────────────────────────────
// 4. HTML 빌더: 뉴스 기사
// ─────────────────────────────────────────
const CARD_COLORS = [
  'linear-gradient(135deg,#0f172a,#1e3a5f)',
  'linear-gradient(135deg,#7f1d1d,#991b1b)',
  'linear-gradient(135deg,#1e293b,#334155)',
  'linear-gradient(135deg,#1e3a5f,#1d4ed8)',
  'linear-gradient(135deg,#14532d,#166534)',
];

function buildNewsHTML(data) {
  const cards = data.cards || [];
  const sections = data.sections || [];

  // 카드 + 섹션 교차 배치
  let bodyHTML = `\n        <div class="prose">\n          ${data.intro || ''}\n        </div>`;

  const len = Math.max(cards.length, sections.length);
  for (let i = 0; i < len; i++) {
    const card = cards[i];
    const section = sections[i];

    if (card) {
      bodyHTML += `
        <div class="card-inline" style="background:${card.bg || CARD_COLORS[i % CARD_COLORS.length]};">
          <span class="card-inline-num">${card.num || String(i + 1).padStart(2, '0')}</span>
          <span class="card-inline-badge" style="background:rgba(251,191,36,0.2);color:#fbbf24;">${escHtml(card.badge || '')}</span>
          <p class="card-inline-title">${escHtml(card.title || '')}</p>
          <p class="card-inline-body">${escHtml(card.body || '')}</p>
          <p class="card-inline-stat" style="color:${card.statColor || '#34d399'};">${escHtml(card.stat || '')}</p>
        </div>`;
    }

    if (section) {
      bodyHTML += `
        <div class="prose">
          <h2 id="${section.id || `section${i + 1}`}">${escHtml(section.heading || '')}</h2>
          ${section.content || ''}
        </div>`;
    }
  }

  const heroStatsHTML = (data.heroStats || []).map(s =>
    `<div><p class="text-white/50 text-xs">${escHtml(s.label)}</p><p style="color:${s.color};" class="font-black text-3xl">${escHtml(s.value)}</p></div>`
  ).join('\n              ');

  const summaryHTML = (data.summary || []).map(s => `<li>${escHtml(s)}</li>`).join('\n            ');

  const tocHTML = sections.map((s, i) =>
    `<a href="#${s.id || `section${i + 1}`}" class="toc-link">${escHtml(s.heading?.replace(/^[^\w가-힣]+/, '') || '')}</a>`
  ).join('\n            ');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js"></script>
  <title>${escHtml(data.title)} - 경제적 자유를 위한 도전</title>
  <meta name="description" content="${escAttr(data.description)}">
  <meta name="keywords" content="${escAttr((data.keywords || []).join(', '))}">
  <meta name="robots" content="index, follow">
  <meta name="google-adsense-account" content="ca-pub-1954893264438671">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1954893264438671" crossorigin="anonymous"></script>
  <link rel="canonical" href="https://bloginfo360.com/posts/${data.slug}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escAttr(data.title)}">
  <meta property="og:description" content="${escAttr(data.description)}">
  <meta property="og:locale" content="ko_KR">
  <meta property="article:published_time" content="${data.date}T09:00:00+09:00">
  <meta property="article:section" content="${escAttr(data.category)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escAttr(data.title)}">
  <meta name="twitter:description" content="${escAttr(data.description)}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(data.title)},
    "description": ${JSON.stringify(data.description)},
    "datePublished": "${data.date}",
    "dateModified": "${data.date}",
    "author": { "@type": "Person", "name": "경제적 자유를 위한 도전" },
    "publisher": { "@type": "Organization", "name": "경제적 자유를 위한 도전" }
  }
  </script>
  ${commonHead()}
</head>
<body class="bg-white text-ink-900">
  ${header()}
  <main class="max-w-5xl mx-auto px-4 py-10">
    <div class="flex flex-col lg:flex-row gap-10">
      <article class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-2 items-center mb-4">
          <span class="text-xs font-bold text-gold-500 bg-yellow-50 px-2.5 py-0.5 rounded-full">${escHtml(data.category)}</span>
          <span class="text-xs text-ink-300">${data.date}</span>
          <span class="text-xs text-ink-300">· 읽는 시간 약 ${data.readMinutes || 5}분</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-black text-ink-900 leading-tight mb-3">${escHtml(data.title)}</h1>
        <p class="text-ink-500 text-sm mb-8 leading-relaxed">${escHtml(data.description)}</p>

        <!-- 히어로 썸네일 -->
        <div class="w-full rounded-2xl overflow-hidden mb-10" style="background:${data.heroGradient || 'linear-gradient(135deg,#0f172a,#1e3a5f)'}; min-height:280px; position:relative;">
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:2rem 2.5rem;">
            <span style="background:rgba(251,191,36,0.15);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);" class="text-xs font-bold px-3 py-1 rounded-full inline-block w-fit mb-4">${escHtml(data.heroEmoji || '')} ${escHtml(data.heroTag || data.category + ' · ' + data.date)}</span>
            <h2 class="text-white font-black leading-tight mb-3" style="font-size:clamp(1.3rem,4vw,2rem);">${escHtml(data.title)}</h2>
            <div class="flex flex-wrap gap-4 mt-2">
              ${heroStatsHTML}
            </div>
            <p class="text-white/40 text-xs mt-4">${escHtml(data.heroSubtext || '')}</p>
          </div>
          <div style="position:absolute;right:-20px;bottom:-20px;font-size:10rem;opacity:0.04;line-height:1;">${data.heroEmoji || '📊'}</div>
        </div>

        ${bodyHTML}

        <!-- 핵심 요약 -->
        <div class="mt-10 bg-brand-50 border border-brand-100 rounded-2xl p-6">
          <h3 class="font-bold text-brand-700 mb-3 text-base">📌 핵심 요약</h3>
          <ul class="space-y-2 text-sm text-ink-700">
            ${summaryHTML}
          </ul>
        </div>

        <!-- 공유 버튼 -->
        <div class="mt-8 flex flex-wrap gap-3">
          <button class="btn-share" onclick="navigator.clipboard.writeText(location.href).then(()=>alert('링크 복사 완료!'))">🔗 링크 복사</button>
          <a class="btn-share" href="https://twitter.com/intent/tweet?url=https://bloginfo360.com/posts/${data.slug}&text=${encodeURIComponent(data.title)}" target="_blank" rel="noopener">🐦 트위터 공유</a>
        </div>

        ${disqus(data.slug)}
      </article>

      <!-- 사이드바 -->
      <aside class="lg:w-64 shrink-0">
        <div class="sticky top-24 space-y-6">
          <div class="bg-ink-100/50 rounded-2xl p-5">
            <p class="font-bold text-ink-700 text-sm mb-3">📋 목차</p>
            <nav>${tocHTML}</nav>
          </div>
          <div class="bg-brand-50 border border-brand-100 rounded-2xl p-5 text-center">
            <p class="font-bold text-brand-700 text-sm mb-2">✉️ 뉴스레터</p>
            <p class="text-xs text-ink-500 mb-3">새 글 알림을 받아보세요</p>
            <a href="../index.html#newsletter" class="inline-block bg-brand-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">구독하기</a>
          </div>
        </div>
      </aside>
    </div>
  </main>
  ${footer()}
</body>
</html>`;
}

// ─────────────────────────────────────────
// 5. HTML 빌더: 제품 리뷰
// ─────────────────────────────────────────
function buildProductReviewHTML(data) {
  const prosHTML = (data.pros || []).map(p => `<li>${escHtml(p)}</li>`).join('\n');
  const consHTML = (data.cons || []).map(c => `<li>${escHtml(c)}</li>`).join('\n');
  const specsHTML = (data.specs || []).map(s =>
    `<tr><td><strong>${escHtml(s.label)}</strong></td><td>${escHtml(s.value)}</td></tr>`
  ).join('\n');
  const summaryHTML = (data.summary || []).map(s => `<li>${escHtml(s)}</li>`).join('\n');
  const sectionsHTML = (data.sections || []).map(s =>
    `<div class="prose"><h2>${escHtml(s.heading)}</h2>${s.content || ''}</div>`
  ).join('\n');

  const imageHTML = data.productImage
    ? `<img src="${escAttr(data.productImage)}" alt="${escAttr(data.productName || '제품 이미지')}" class="w-full rounded-2xl mb-8 object-contain max-h-96 bg-gray-50" loading="lazy">`
    : `<div class="w-full rounded-2xl mb-8 bg-ink-100 flex items-center justify-center" style="height:240px;"><span class="text-6xl">📦</span></div>`;

  const stars = '⭐'.repeat(Math.round(Math.min(5, Math.max(1, data.rating || 4))));
  const btnLabel = data.platform === 'coupang' ? '쿠팡에서 보기' : '네이버에서 보기';
  const btnLabel2 = data.platform === 'coupang' ? '쿠팡에서 구매하기' : '네이버에서 구매하기';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js"></script>
  <title>${escHtml(data.title)} - 경제적 자유를 위한 도전</title>
  <meta name="description" content="${escAttr(data.description)}">
  <meta name="keywords" content="${escAttr((data.keywords || []).join(', '))}">
  <meta name="robots" content="index, follow">
  <meta name="google-adsense-account" content="ca-pub-1954893264438671">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1954893264438671" crossorigin="anonymous"></script>
  <link rel="canonical" href="https://bloginfo360.com/posts/${data.slug}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escAttr(data.title)}">
  <meta property="og:description" content="${escAttr(data.description)}">
  ${data.productImage ? `<meta property="og:image" content="${escAttr(data.productImage)}">` : ''}
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Review",
    "headline": ${JSON.stringify(data.title)},
    "description": ${JSON.stringify(data.description)},
    "datePublished": "${data.date}",
    "author": { "@type": "Person", "name": "경제적 자유를 위한 도전" },
    "reviewRating": { "@type": "Rating", "ratingValue": "${data.rating || 4}", "bestRating": "5" }
  }
  </script>
  ${commonHead()}
  <style>
    .btn-affiliate { display:inline-flex; align-items:center; gap:8px; padding:14px 28px; border-radius:12px; font-size:1rem; font-weight:700; background:#16a34a; color:white; text-decoration:none; transition:background 0.15s, transform 0.1s; }
    .btn-affiliate:hover { background:#15803d; transform:scale(1.02); }
    .btn-affiliate:active { transform:scale(0.98); }
  </style>
</head>
<body class="bg-white text-ink-900">
  ${header()}
  <main class="max-w-3xl mx-auto px-4 py-10">
    <!-- 제휴 마케팅 고지 (필수) -->
    <div class="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-8 text-sm text-amber-800">
      ⚠️ ${escHtml(data.disclaimer)}
    </div>

    <div class="flex flex-wrap gap-2 items-center mb-4">
      <span class="text-xs font-bold text-gold-500 bg-yellow-50 px-2.5 py-0.5 rounded-full">📦 제품리뷰</span>
      <span class="text-xs text-ink-300">${data.date}</span>
      <span class="text-xs text-ink-300">· 읽는 시간 약 ${data.readMinutes || 4}분</span>
    </div>

    <h1 class="text-2xl sm:text-3xl font-black text-ink-900 leading-tight mb-3">${escHtml(data.title)}</h1>
    <p class="text-ink-500 text-sm mb-6 leading-relaxed">${escHtml(data.description)}</p>

    <!-- 평점 -->
    <div class="flex items-center gap-3 mb-8 p-4 bg-ink-100/40 rounded-xl">
      <span class="text-2xl">${stars}</span>
      <span class="font-black text-2xl text-ink-900">${data.rating}</span>
      <span class="text-sm text-ink-500">/ 5.0</span>
    </div>

    <!-- 제품 이미지 -->
    ${imageHTML}

    <!-- 구매 버튼 상단 -->
    <div class="text-center mb-10">
      <a href="${escAttr(data.affiliateUrl)}" target="_blank" rel="noopener sponsored" class="btn-affiliate">🛒 ${btnLabel}</a>
    </div>

    <!-- 도입부 -->
    <div class="prose mb-8">${data.intro || ''}</div>

    <!-- 장단점 -->
    <div class="grid sm:grid-cols-2 gap-4 mb-8">
      <div class="bg-green-50 border border-green-100 rounded-xl p-5">
        <h3 class="font-bold text-green-700 mb-3 text-sm">👍 장점</h3>
        <ul class="space-y-2 text-sm text-ink-700">${prosHTML}</ul>
      </div>
      <div class="bg-red-50 border border-red-100 rounded-xl p-5">
        <h3 class="font-bold text-red-700 mb-3 text-sm">👎 단점</h3>
        <ul class="space-y-2 text-sm text-ink-700">${consHTML}</ul>
      </div>
    </div>

    ${specsHTML ? `<div class="prose mb-8"><h2>📋 제품 스펙</h2><table><tbody>${specsHTML}</tbody></table></div>` : ''}

    ${sectionsHTML}

    <!-- 핵심 요약 -->
    <div class="mt-10 bg-brand-50 border border-brand-100 rounded-2xl p-6">
      <h3 class="font-bold text-brand-700 mb-3 text-base">📌 이런 분께 추천해요</h3>
      <p class="text-sm text-ink-700 mb-3">${escHtml(data.targetUser || '')}</p>
      <ul class="space-y-2 text-sm text-ink-700">${summaryHTML}</ul>
    </div>

    <!-- 구매 버튼 하단 -->
    <div class="text-center mt-10">
      <a href="${escAttr(data.affiliateUrl)}" target="_blank" rel="noopener sponsored" class="btn-affiliate">🛒 ${btnLabel2}</a>
      <p class="text-xs text-ink-300 mt-3">${escHtml(data.disclaimer)}</p>
    </div>

    <!-- 공유 버튼 -->
    <div class="mt-8 flex flex-wrap gap-3">
      <button class="btn-share" onclick="navigator.clipboard.writeText(location.href).then(()=>alert('링크 복사 완료!'))">🔗 링크 복사</button>
    </div>

    ${disqus(data.slug)}
  </main>
  ${footer()}
</body>
</html>`;
}

// ─────────────────────────────────────────
// 6. index.html 포스트 카드 추가
// ─────────────────────────────────────────
const CAT_CONFIG = {
  '경제':   { emoji: '💰', tagColor: '#fbbf24', tagBg: 'rgba(251,191,36,0.15)', cardBg: 'linear-gradient(135deg,#0f172a,#1e3a5f)' },
  '부동산': { emoji: '🏠', tagColor: '#34d399', tagBg: 'rgba(52,211,153,0.15)', cardBg: 'linear-gradient(135deg,#064e3b,#065f46)' },
  '주식':   { emoji: '📈', tagColor: '#60a5fa', tagBg: 'rgba(96,165,250,0.15)', cardBg: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' },
  '복지정책': { emoji: '🏛️', tagColor: '#c084fc', tagBg: 'rgba(192,132,252,0.15)', cardBg: 'linear-gradient(135deg,#3b0764,#6b21a8)' },
  '제품리뷰': { emoji: '📦', tagColor: '#fb923c', tagBg: 'rgba(251,146,60,0.15)', cardBg: 'linear-gradient(135deg,#7c2d12,#9a3412)' },
};

function buildPostCard(data) {
  const cfg = CAT_CONFIG[data.category] || CAT_CONFIG['경제'];
  const dateStr = data.date.replace(/-/g, '.');
  const shortDesc = (data.description || '').substring(0, 80) + '...';

  return `
      <!-- AUTO: ${data.title} -->
      <article class="post-item post-card rounded-2xl border border-ink-100 overflow-hidden bg-white shadow-card cursor-pointer"
               data-category="${escAttr(data.category)}" data-title="${escAttr(data.title)}"
               onclick="location.href='posts/${data.slug}.html'">
        <div class="h-44 relative overflow-hidden" style="background:${cfg.cardBg};">
          <div class="absolute inset-0 flex flex-col justify-between p-4">
            <div class="flex items-center justify-between">
              <span style="background:${cfg.tagBg};color:${cfg.tagColor};" class="text-xs font-bold px-2 py-0.5 rounded-full border border-white/10">${cfg.emoji} ${escHtml(data.category)}</span>
              <span class="text-xs text-white/40">${dateStr}</span>
            </div>
            <div>
              <p class="text-white font-black text-base leading-tight line-clamp-2">${escHtml(data.title)}</p>
            </div>
          </div>
          <div class="absolute -right-3 -top-3 text-8xl opacity-5">${cfg.emoji}</div>
        </div>
        <div class="p-5">
          <span class="text-xs font-bold text-gold-500 bg-yellow-50 px-2 py-0.5 rounded-full">${escHtml(data.category)}</span>
          <h2 class="mt-2 font-bold text-ink-900 text-base leading-snug">${escHtml(data.title)}</h2>
          <p class="mt-1.5 text-xs text-ink-500 line-clamp-2">${escHtml(shortDesc)}</p>
          <div class="mt-4 flex items-center justify-between text-xs text-ink-300">
            <span>${dateStr}</span>
            <span class="flex items-center gap-1 text-brand-600 font-bold">🆕 NEW</span>
          </div>
        </div>
      </article>`;
}

function updateIndexHTML(data) {
  const indexPath = path.join(ROOT, 'index.html');
  let html = readFileSync(indexPath, 'utf-8');

  const card = buildPostCard(data);
  const marker = '<!-- POSTS_START -->';

  if (html.includes(marker)) {
    html = html.replace(marker, marker + '\n' + card);
  } else {
    // 폴백: postGrid div 직후에 삽입
    html = html.replace(
      /(<div id="postGrid"[^>]*>)/,
      `$1\n      ${marker}\n${card}`
    );
  }

  writeFileSync(indexPath, html, 'utf-8');
  console.log(`✅ index.html 포스트 카드 추가 완료`);
}

// ─────────────────────────────────────────
// 7. sitemap.xml 업데이트
// ─────────────────────────────────────────
function updateSitemap(data) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let xml = readFileSync(sitemapPath, 'utf-8');

  const newEntry = `
  <url>
    <loc>https://bloginfo360.com/posts/${data.slug}</loc>
    <lastmod>${data.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;

  xml = xml.replace('</urlset>', newEntry + '\n</urlset>');
  writeFileSync(sitemapPath, xml, 'utf-8');
  console.log(`✅ sitemap.xml 업데이트 완료`);
}

// ─────────────────────────────────────────
// 8. 파일 저장
// ─────────────────────────────────────────
function savePost(data, html) {
  const postsDir = path.join(ROOT, 'posts');
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });

  const filePath = path.join(postsDir, `${data.slug}.html`);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ 포스트 저장: posts/${data.slug}.html`);
}

// ─────────────────────────────────────────
// 헬퍼 함수들
// ─────────────────────────────────────────
function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

function sanitizeSlug(slug) {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function commonHead() {
  return `<script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:"#f0fdf4", 100:"#dcfce7", 600:"#16a34a", 700:"#15803d" },
            gold:  { 400:"#fbbf24", 500:"#f59e0b" },
            ink:   { 900:"#0f172a", 700:"#1e293b", 500:"#475569", 300:"#94a3b8", 100:"#f1f5f9" }
          },
          fontFamily: { sans: ["Noto Sans KR", "sans-serif"] }
        }
      }
    }
  </script>
  <style>
    body { font-family: "Noto Sans KR", sans-serif; }
    .prose h2 { font-size:1.35rem; font-weight:700; margin:2.2rem 0 0.8rem; color:#0f172a; border-left:4px solid #16a34a; padding-left:12px; }
    .prose h3 { font-size:1.1rem; font-weight:700; margin:1.6rem 0 0.5rem; color:#1e293b; }
    .prose p  { line-height:1.9; margin-bottom:1.1rem; color:#475569; font-size:0.97rem; }
    .prose ul { list-style:none; padding-left:0; margin-bottom:1rem; color:#475569; font-size:0.97rem; }
    .prose ul li { margin-bottom:0.5rem; line-height:1.7; padding-left:1.5rem; position:relative; }
    .prose ul li::before { content:"✅"; position:absolute; left:0; }
    .prose strong { color:#0f172a; font-weight:700; }
    .prose blockquote { background:#f0fdf4; border-left:4px solid #16a34a; padding:14px 18px; border-radius:0 8px 8px 0; margin:1.5rem 0; color:#1e293b; font-size:0.95rem; line-height:1.8; }
    .prose table { width:100%; border-collapse:collapse; margin:1.5rem 0; font-size:0.9rem; }
    .prose table th { background:#f1f5f9; font-weight:700; padding:10px 14px; text-align:left; color:#1e293b; }
    .prose table td { padding:10px 14px; border-bottom:1px solid #e2e8f0; color:#475569; }
    .prose table tr:hover td { background:#f8fafc; }
    .prose hr { border:none; border-top:1px solid #e2e8f0; margin:2rem 0; }
    .btn-share { display:inline-flex; align-items:center; gap:6px; padding:8px 18px; border-radius:8px; font-size:0.82rem; font-weight:600; border:1.5px solid #e2e8f0; background:#fff; color:#475569; cursor:pointer; transition:border-color 0.15s,color 0.15s,background 0.15s,transform 0.1s; text-decoration:none; }
    .btn-share:hover { border-color:#16a34a; color:#16a34a; background:#f0fdf4; }
    .btn-share:focus { outline:none; box-shadow:0 0 0 3px rgba(22,163,74,0.2); }
    .btn-share:active { transform:scale(0.97); }
    .toc-link { display:block; padding:4px 0; color:#475569; font-size:0.85rem; text-decoration:none; transition:color 0.15s; }
    .toc-link:hover { color:#16a34a; }
    .card-inline { border-radius:16px; padding:24px 28px; margin:2rem 0; position:relative; overflow:hidden; }
    .card-inline-num { font-size:5rem; font-weight:900; opacity:0.08; position:absolute; top:8px; right:16px; line-height:1; color:white; }
    .card-inline-badge { font-size:0.7rem; font-weight:700; padding:3px 12px; border-radius:99px; display:inline-block; margin-bottom:10px; }
    .card-inline-title { font-size:1.2rem; font-weight:900; line-height:1.4; margin-bottom:10px; color:white; }
    .card-inline-body { font-size:0.88rem; line-height:1.8; color:rgba(255,255,255,0.75); margin-bottom:14px; }
    .card-inline-stat { font-size:2.2rem; font-weight:900; line-height:1; }
  </style>`;
}

function header() {
  return `<header class="sticky top-0 z-50 bg-white border-b border-ink-100 shadow-sm">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="../index.html" class="text-xl font-black text-brand-600 leading-tight">경제적 자유를<br class="sm:hidden"> 위한 도전</a>
      <nav class="hidden sm:flex items-center gap-6 text-sm font-medium text-ink-500">
        <a href="../index.html" class="hover:text-brand-600 transition-colors">홈</a>
        <a href="../index.html#category" class="hover:text-brand-600 transition-colors">카테고리</a>
        <a href="../index.html#newsletter" class="hover:text-brand-600 transition-colors">뉴스레터</a>
      </nav>
      <div class="sm:hidden flex gap-4 text-sm font-medium text-ink-500">
        <a href="../index.html#category" class="hover:text-brand-600">카테고리</a>
      </div>
    </div>
  </header>`;
}

function footer() {
  return `<footer class="border-t border-ink-100 mt-16 py-8 text-center text-xs text-ink-300">
    <p>© 2026 경제적 자유를 위한 도전. All rights reserved.</p>
    <p class="mt-1"><a href="../index.html" class="hover:text-brand-600">홈으로 돌아가기</a></p>
  </footer>`;
}

function disqus(slug) {
  return `<div class="mt-12 pt-8 border-t border-ink-100">
      <div id="disqus_thread"></div>
      <script>
        var disqus_config = function() {
          this.page.url = 'https://bloginfo360.com/posts/${slug}';
          this.page.identifier = '${slug}';
        };
        (function() {
          var d = document, s = d.createElement('script');
          s.src = 'https://gyeongjejeog-jayureul-wihan-dojeon.disqus.com/embed.js';
          s.setAttribute('data-timestamp', +new Date());
          (d.head || d.body).appendChild(s);
        })();
      <\/script>
    </div>`;
}

// ─────────────────────────────────────────
// 9. 메인 실행
// ─────────────────────────────────────────
async function main() {
  console.log(`\n🚀 자동 글 생성 시작`);
  console.log(`   모드: ${MODE}`);
  console.log(`   날짜: ${getKSTDate()}\n`);

  if (MODE === 'news') {
    console.log(`   카테고리: ${CATEGORIES_TO_RUN.join(', ')}`);

    for (const category of CATEGORIES_TO_RUN) {
      try {
        const data = await generateNewsArticle(category);
        const html = buildNewsHTML(data);
        savePost(data, html);
        updateIndexHTML(data);
        updateSitemap(data);
        console.log(`\n✅ [${category}] 완료: ${data.title}`);
        await sleep(3000); // API rate limit 방지
      } catch (e) {
        console.error(`\n❌ [${category}] 실패:`, e.message);
      }
    }
  } else if (MODE === 'product_review') {
    const links = PRODUCT_LINKS_RAW
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    console.log(`   제품 링크 수: ${links.length}`);

    for (const line of links) {
      const parts = line.split('|');
      const url = parts[0]?.trim();
      const platform = (parts[1]?.trim() || 'coupang').toLowerCase();

      if (!url) continue;

      try {
        const data = await generateProductReview(url, platform);
        const html = buildProductReviewHTML(data);
        savePost(data, html);
        updateIndexHTML(data);
        updateSitemap(data);
        console.log(`\n✅ [제품리뷰] 완료: ${data.title}`);
        await sleep(3000);
      } catch (e) {
        console.error(`\n❌ [제품리뷰] 실패 (${url}):`, e.message);
      }
    }
  }

  console.log('\n🎉 모든 글 생성 완료!');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
