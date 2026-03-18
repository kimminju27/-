/**
 * 자동 글 생성 스크립트
 * - news 모드: Google News RSS → Gemini API → 뉴스 기사 HTML 생성
 * - product_review 모드: 제품 URL → Gemini API → 리뷰 HTML 생성
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

async function callGroq(prompt, { maxTokens = 4000, jsonMode = false, systemMsg = '' } = {}) {
  const messages = [];
  if (systemMsg) messages.push({ role: 'system', content: systemMsg });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: 'llama-3.3-70b-versatile',
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Groq API 오류: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// 중국어/일본어 한자 제거 (한국어 한자는 유지)
function removeForeignChars(text) {
  if (typeof text !== 'string') return text;
  // CJK Unified Ideographs (중국어) 제거, 한국어(가-힣)는 유지
  return text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2A6DF}]/gu, '');
}

function sanitizeReviewData(data) {
  if (!data || typeof data !== 'object') return data;
  const sanitize = (v) => {
    if (typeof v === 'string') return removeForeignChars(v);
    if (Array.isArray(v)) return v.map(sanitize);
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, sanitize(val)]));
    }
    return v;
  };
  return sanitize(data);
}

// 하위 호환용 alias
const callGemini = (prompt) => callGroq(prompt);

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

  const prompt = `You are a professional Korean economic blogger with 10 years of experience. Write a detailed, data-rich blog post in KOREAN ONLY.

Date: ${today}
Category: ${category}

Latest news to reference:
${newsContext}

STRICT RULES — VIOLATIONS WILL MAKE THE ARTICLE USELESS:
1. Write ONLY in Korean (한국어만 사용). ZERO Japanese, Chinese, or English words in the content.
2. NEVER use phrases like "알아보겠습니다", "살펴보겠습니다", "모색해보겠습니다", "분석해보겠습니다" — start with the actual content immediately.
3. Every section MUST contain at least 3 specific numbers/percentages/dates/amounts (예: 3.5%, 1,380원, 2026년 4월).
4. Include at least one HTML table with real comparison data.
5. Last section MUST be a practical checklist of "지금 당장 해야 할 것 3가지".
6. NO placeholder images, NO graph references, NO "그래프 참조" — use tables and text only.
7. Each section content must be 300+ Korean characters.
8. First sentence of intro must contain a specific shocking number.

Respond with ONLY valid JSON (no code blocks, no markdown):
{
  "title": "구체적 수치 포함한 SEO 제목 (45-65자)",
  "description": "독자가 얻을 것을 명시한 메타 설명 (80-120자)",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "slug": "short-english-slug",
  "heroGradient": "linear-gradient(135deg, #0f172a, #1e3a5f)",
  "heroEmoji": "💰",
  "heroTag": "${category} · ${today}",
  "heroStats": [
    {"label": "핵심 지표명", "value": "+X.X%", "color": "#f87171"},
    {"label": "다른 지표명", "value": "X,XXX원", "color": "#fbbf24"},
    {"label": "세번째 지표", "value": "X위", "color": "#34d399"}
  ],
  "heroSubtext": "이 글을 읽으면 얻게 되는 것 (구체적으로)",
  "intro": "<p>[첫 문장: 충격적인 수치로 시작] 예: 지난주 원/달러 환율이 1,450원을 돌파했습니다. [독자 상황 공감 2-3문장]</p><p>[이 글에서 다룰 핵심 3가지를 구체적으로 나열]</p>",
  "cards": [
    {
      "num": "01",
      "badge": "핵심 이슈",
      "title": "구체적 수치 포함 카드 제목",
      "body": "수치와 날짜 포함한 구체적 설명. 내 지갑에 미치는 영향. 구체적 금액 예시. (4-5문장)",
      "stat": "+X.X% 또는 X만원↑",
      "statColor": "#f87171",
      "bg": "linear-gradient(135deg, #0f172a, #1e3a5f)"
    },
    {
      "num": "02",
      "badge": "영향 분석",
      "title": "두번째 카드 제목",
      "body": "구체적 내용 (4-5문장)",
      "stat": "핵심 수치",
      "statColor": "#fbbf24",
      "bg": "linear-gradient(135deg, #7f1d1d, #991b1b)"
    },
    {
      "num": "03",
      "badge": "실전 대응",
      "title": "세번째 카드 제목",
      "body": "구체적 내용 (4-5문장)",
      "stat": "핵심 수치",
      "statColor": "#34d399",
      "bg": "linear-gradient(135deg, #14532d, #166534)"
    },
    {
      "num": "04",
      "badge": "전망",
      "title": "네번째 카드 제목",
      "body": "구체적 내용 (4-5문장)",
      "stat": "핵심 수치",
      "statColor": "#60a5fa",
      "bg": "linear-gradient(135deg, #1e3a5f, #1d4ed8)"
    }
  ],
  "sections": [
    {
      "id": "section1",
      "heading": "🔍 [구체적 섹션 제목 — 수치 포함]",
      "content": "<p>300자 이상의 구체적 본문. 수치, 날짜, 사례 포함.</p><table><thead><tr><th>구분</th><th>이전</th><th>현재</th><th>변화</th></tr></thead><tbody><tr><td>항목1</td><td>값</td><td>값</td><td>+X%</td></tr><tr><td>항목2</td><td>값</td><td>값</td><td>+X%</td></tr></tbody></table><p>표 해석 및 독자에게 미치는 영향 설명.</p>"
    },
    {
      "id": "section2",
      "heading": "💸 [두번째 섹션 제목]",
      "content": "<p>300자 이상 본문.</p><blockquote>핵심 인사이트나 중요 수치를 강조한 인용구</blockquote><p>추가 설명.</p><ul><li><strong>포인트1:</strong> 구체적 설명</li><li><strong>포인트2:</strong> 구체적 설명</li><li><strong>포인트3:</strong> 구체적 설명</li></ul>"
    },
    {
      "id": "section3",
      "heading": "📊 [세번째 섹션 제목]",
      "content": "<p>300자 이상 본문. 반드시 수치 포함.</p><p>추가 분석.</p>"
    },
    {
      "id": "section4",
      "heading": "🏦 [네번째 섹션 제목]",
      "content": "<p>300자 이상 본문.</p><p>구체적 사례와 수치.</p>"
    },
    {
      "id": "checklist",
      "heading": "✅ 지금 당장 해야 할 것 3가지",
      "content": "<p>이 상황에서 독자가 오늘 바로 실행할 수 있는 행동 3가지입니다.</p><ul><li><strong>1. [구체적 행동]:</strong> 언제, 어떻게, 얼마나 — 구체적으로 설명 (2-3문장)</li><li><strong>2. [구체적 행동]:</strong> 구체적 설명 (2-3문장)</li><li><strong>3. [구체적 행동]:</strong> 구체적 설명 (2-3문장)</li></ul><blockquote>핵심 한 줄 요약</blockquote>"
    }
  ],
  "summary": ["✅ 오늘 당장: 구체적 행동", "📌 핵심 팩트: 수치 포함 요약", "🔮 앞으로: 주목할 날짜/지표"],
  "readMinutes": 7
}`;

  const text = await callGemini(prompt);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON을 찾을 수 없습니다');

  const data = JSON.parse(jsonMatch[0]);
  data.category = category;
  data.date = today;

  if (!data.slug) data.slug = `${category}-${today}`;
  data.slug = sanitizeSlug(data.slug) + '-' + today;

  return data;
}

// ─────────────────────────────────────────
// 3. 제품 리뷰 생성
// ─────────────────────────────────────────

// 네이버 쇼핑 API로 제품 정보 자동 수집
async function fetchProductFromNaverAPI(query) {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.log('   └ [네이버 API] 키 없음 → 수동 모드');
    return null;
  }

  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=5&sort=sim`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`   └ [네이버 API] HTTP ${res.status}: ${errText.substring(0, 100)}`);
      return null;
    }

    const json = await res.json();
    console.log(`   └ [네이버 API] 검색 결과: ${json.total}건`);

    const item = json.items?.[0];
    if (!item) {
      console.warn('   └ [네이버 API] 검색 결과 없음');
      return null;
    }

    const title = item.title.replace(/<[^>]+>/g, '').trim();
    const price = parseInt(item.lprice || '0', 10);
    const priceStr = price > 0 ? price.toLocaleString('ko-KR') + '원' : '';
    const images = json.items.slice(0, 5).map(i => i.image).filter(Boolean);

    console.log(`   └ [네이버 API] ✅ 제품명: ${title}`);
    console.log(`   └ [네이버 API] ✅ 가격: ${priceStr}`);
    console.log(`   └ [네이버 API] ✅ 이미지: ${images.length}장`);
    if (images[0]) console.log(`   └ [네이버 API] 첫 이미지: ${images[0]}`);

    return { title, price: priceStr, image: images[0] || '', images, description: title, bodyText: '' };
  } catch (e) {
    console.warn('   └ [네이버 API] 오류:', e.message);
    return null;
  }
}

// 에러 페이지 감지 키워드
const ERROR_PAGE_KEYWORDS = ['시스템오류', '에러페이지', '오류가 발생', 'error page', '서비스 점검', '페이지를 찾을 수 없', '존재하지 않는 페이지', '접근이 제한'];

function isErrorPage(title, bodyText) {
  const combined = (title + ' ' + bodyText).toLowerCase();
  return ERROR_PAGE_KEYWORDS.some(kw => combined.includes(kw.toLowerCase()));
}

async function fetchProductInfo(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    const finalUrl = res.url;
    const html = await res.text();

    const getOg = (prop) =>
      html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]+)"`))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="og:${prop}"`))?.[1] || '';

    const getMeta = (name) =>
      html.match(new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]+)"`))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+name="${name}"`))?.[1] || '';

    const htmlTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';

    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3000);

    const title = getOg('title') || htmlTitle;
    const description = getOg('description') || getMeta('description');
    const ogImage = getOg('image');

    // 에러 페이지 감지
    if (isErrorPage(title, bodyText)) {
      console.warn(`   └ ⚠️ 에러 페이지 감지됨 (제목: "${title}") — 스크래핑 실패로 처리`);
      return null;
    }

    // 제품 이미지 여러 장 수집 (OG 이미지 + img 태그)
    const images = [];
    if (ogImage) images.push(ogImage);
    const imgRegex = /<img[^>]+src="(https?:\/\/[^"]+)"/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 6) {
      const src = imgMatch[1];
      if (!images.includes(src) && /\.(jpg|jpeg|png|webp)/i.test(src) &&
          !src.includes('logo') && !src.includes('icon') && !src.includes('banner')) {
        images.push(src);
      }
    }

    console.log(`   └ 제품명: ${title || '(없음)'}`);
    console.log(`   └ 설명: ${description?.substring(0, 60) || '(없음)'}...`);
    console.log(`   └ 이미지: ${images.length}장`);
    console.log(`   └ 본문 텍스트: ${bodyText.length}자`);

    return { title, image: ogImage, images, description, url: finalUrl || url, bodyText };
  } catch (e) {
    console.warn('제품 페이지 가져오기 실패:', e.message);
    return null;
  }
}

async function generateProductReview(productUrl, platform = 'coupang', scrapeUrl = null, manualName = '', manualPrice = '', manualImages = []) {
  console.log(`\n📦 제품 리뷰 생성 중: ${productUrl}`);

  const today = getKSTDate();
  let info = null;

  const productName = manualName || '';

  // 1순위: 네이버 쇼핑 API (API 키 있을 때)
  if (productName && NAVER_CLIENT_ID) {
    console.log(`   └ 네이버 쇼핑 API로 정보 수집 중...`);
    const apiInfo = await fetchProductFromNaverAPI(productName);
    if (apiInfo) {
      info = apiInfo;
      // 수동 이미지가 있으면 API 이미지 앞에 추가
      if (manualImages.length > 0) {
        info.images = [...manualImages, ...info.images];
        info.image = manualImages[0];
      }
      // 수동 가격이 있으면 우선 사용
      if (manualPrice) info.price = manualPrice;
    }
  }

  // 2순위: 수동 입력 (API 키 없거나 API 실패 시)
  if (!info && productName) {
    console.log(`   └ 수동 입력 모드`);
    info = { title: productName, price: manualPrice, description: '', image: manualImages[0] || '', images: manualImages, bodyText: '' };
  }

  // 3순위: 직접 스크래핑
  if (!info) {
    if (scrapeUrl) console.log(`   └ 스크래핑 URL: ${scrapeUrl}`);
    info = await fetchProductInfo(scrapeUrl || productUrl);
    if (info) {
      if (manualImages.length > 0) { info.images = [...manualImages, ...info.images]; info.image = manualImages[0]; }
      if (manualPrice) info.price = manualPrice;
    }
  }

  if (!info || !info.title) {
    throw new Error(
      `제품 정보를 가져올 수 없습니다.\n` +
      `형식: ${productUrl}|${platform}|제품명|가격|이미지URL1,이미지URL2`
    );
  }

  const disclaimer = platform === 'coupang'
    ? '이 포스팅은 쿠팡 파트너스 활동의 일환으로 이에 따른 일정액의 수수료를 제공받습니다.'
    : '본 포스팅은 네이버 쇼핑커넥트의 일환으로 판매시 수수료를 지급받을 수 있습니다.';

  const finalPrice = manualPrice || info.price || '';

  const systemMsg = `당신은 대한민국 최고의 제품 리뷰 블로거입니다.
규칙:
1. 순수 한국어만 사용. 中文(중국 한자), 日本語, English 단어 절대 금지.
2. "们" "經" "験" 같은 한자 절대 금지.
3. "알아보겠습니다" "살펴보겠습니다" 금지.
4. 반드시 valid JSON으로만 응답.`;

  const productDesc = info.bodyText?.substring(0, 1500) || info.description || '';

  const prompt = `다음 제품의 구매 유도 리뷰를 작성하고 JSON으로 반환하세요.

제품명: ${info.title}
${finalPrice ? `가격: ${finalPrice}` : ''}
제품 설명: ${productDesc || '없음 (제품명 기반으로 창의적으로 작성)'}

===아래 JSON을 완성하세요. 각 섹션 content는 반드시 실제 리뷰 내용 (400자 이상 한국어)으로 채우세요.===

{
  "title": "클릭을 부르는 제목. 제품명 + 감성 훅. 예: '써봤는데 이건 진심이에요' / '솔직히 이 가격에 이게 돼?'. 50-65자.",
  "productName": "${info.title}",
  "description": "90-120자 메타 설명. 구매 욕구 자극.",
  "keywords": ["관련키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "slug": "영문-슬러그-review",
  "price": "${finalPrice || '네이버 최저가 확인'}",
  "intro": "2문단 HTML. 독자가 공감할 상황으로 시작. 이 제품을 찾게 된 배경. 이 리뷰에서 다룰 핵심 3가지.",
  "pros": [
    "✨ 구체적 장점 1 (수치 포함)",
    "💡 구체적 장점 2",
    "🎯 구체적 장점 3",
    "🏆 구체적 장점 4",
    "🔥 구체적 장점 5",
    "💰 구체적 장점 6"
  ],
  "cons": [
    "굳이 꼽자면 — 아주 사소한 점 1",
    "미세하게 아쉬운 점 2"
  ],
  "specs": [
    {"label": "스펙항목1", "value": "값"},
    {"label": "스펙항목2", "value": "값"},
    {"label": "스펙항목3", "value": "값"}
  ],
  "sections": [
    {
      "heading": "🎨 디자인 & 첫인상 — 박스 열었을 때 느낌",
      "content": "여기에 400자 이상의 실제 리뷰 내용 작성. 제품을 처음 받았을 때 포장, 외관, 재질, 색상에 대한 생생한 묘사. 비슷한 제품과 비교. <ul> 또는 <blockquote> 포함."
    },
    {
      "heading": "✅ 실제 사용 후기 — 써보니 이랬습니다",
      "content": "여기에 400자 이상의 실제 사용 경험담. 언제 어떻게 사용했는지. 구매 전 고민했던 부분이 해결됐는지. 비포/애프터. <ul> 포함."
    },
    {
      "heading": "💰 이 가격에 이게 맞아? — 가격 대비 가치",
      "content": "여기에 400자 이상의 가격 정당화 내용. 다른 유사 제품과 가격·품질 비교. 왜 이 제품이 더 나은지. <table> 비교표 포함."
    },
    {
      "heading": "🙋 이런 분이라면 무조건 사세요",
      "content": "여기에 400자 이상의 구체적 추천 대상 묘사. 이 제품이 딱 맞는 상황/사람. 구매 결정을 유도하는 마무리. <ul> + <blockquote> 포함."
    }
  ],
  "rating": 4.6,
  "summary": [
    "🏆 핵심 장점: 구체적으로",
    "💡 이런 분께 강추: 구체적 상황",
    "🎁 의외의 장점: 예상 못한 좋은 점"
  ],
  "targetUser": "이 제품이 딱 맞는 구체적인 사람 묘사",
  "readMinutes": 6
}`;

  const text = await callGroq(prompt, { maxTokens: 7000, jsonMode: false, systemMsg });

  // JSON 추출 (코드블록 포함 대응)
  const jsonMatch = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON 파싱 실패 — 응답:\n' + text.substring(0, 400));

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('JSON 파싱 오류: ' + e.message + '\n응답:\n' + text.substring(0, 400));
  }

  // 중국어/외국 한자 제거
  data = sanitizeReviewData(data);

  data.category = '제품리뷰';
  data.date = today;
  data.platform = platform;
  data.disclaimer = disclaimer;
  data.affiliateUrl = productUrl;
  data.productImage = info.image;
  data.productImages = info.images || [];

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
          <p class="card-inline-body">${card.body || ''}</p>
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

  const hashtagsHTML = (data.keywords || []).map(k =>
    `<span class="text-xs text-ink-500 bg-ink-100 px-2.5 py-1 rounded-full">#${escHtml(k.replace(/\s+/g, ''))}</span>`
  ).join('\n          ');

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

        <!-- 해시태그 -->
        <div class="mt-8 flex flex-wrap gap-2">
          ${hashtagsHTML}
        </div>

        <!-- 공유 버튼 -->
        <div class="mt-4 pt-6 border-t border-ink-100 flex flex-wrap gap-3">
          <button class="btn-share" onclick="navigator.clipboard.writeText(location.href).then(()=>alert('✅ 링크가 복사되었습니다!'))">🔗 링크 복사</button>
          <a class="btn-share" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(data.title)}&url=https://bloginfo360.com/posts/${data.slug}" target="_blank" rel="noopener">🐦 X(트위터) 공유</a>
          <a class="btn-share" href="https://www.facebook.com/sharer/sharer.php?u=https://bloginfo360.com/posts/${data.slug}" target="_blank" rel="noopener">📘 페이스북 공유</a>
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
  const consHTML = (data.cons || []).map(c => `<li class="text-ink-300">${escHtml(c)}</li>`).join('\n');
  const specsHTML = (data.specs || []).map(s =>
    `<tr><td><strong>${escHtml(s.label)}</strong></td><td>${escHtml(s.value)}</td></tr>`
  ).join('\n');
  const summaryHTML = (data.summary || []).map(s => `<li>${escHtml(s)}</li>`).join('\n');

  // 섹션 사이사이 이미지 삽입
  const allImages = data.productImages?.length > 0 ? data.productImages : (data.productImage ? [data.productImage] : []);
  const sections = data.sections || [];
  const sectionsHTML = sections.map((s, i) => {
    const img = allImages[i + 1]; // 0번은 상단에 이미 사용
    const imgTag = img
      ? `<img src="${escAttr(img)}" alt="${escAttr(data.productName || '제품')}" class="w-full rounded-2xl my-6 object-contain max-h-80 bg-gray-50" loading="lazy">`
      : '';
    return `<div class="prose">\n  <h2>${escHtml(s.heading)}</h2>\n  ${s.content || ''}\n  ${imgTag}\n</div>`;
  }).join('\n\n');

  const imageHTML = allImages[0]
    ? `<img src="${escAttr(allImages[0])}" alt="${escAttr(data.productName || '제품 이미지')}" class="w-full rounded-2xl mb-8 object-contain max-h-96 bg-gray-50" loading="lazy">`
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

    <!-- 평점 + 가격 -->
    <div class="flex items-center justify-between gap-3 mb-8 p-4 bg-ink-100/40 rounded-xl flex-wrap">
      <div class="flex items-center gap-3">
        <span class="text-2xl">${stars}</span>
        <span class="font-black text-2xl text-ink-900">${data.rating}</span>
        <span class="text-sm text-ink-500">/ 5.0</span>
      </div>
      ${data.price ? `<div class="text-right"><p class="text-xs text-ink-300">현재 가격</p><p class="font-black text-xl text-brand-600">${escHtml(data.price)}</p></div>` : ''}
    </div>

    <!-- 제품 이미지 -->
    ${imageHTML}

    <!-- 구매 버튼 상단 -->
    <div class="text-center mb-10">
      <a href="${escAttr(data.affiliateUrl)}" target="_blank" rel="noopener sponsored" class="btn-affiliate">🛒 ${btnLabel}</a>
    </div>

    <!-- 도입부 -->
    <div class="prose mb-8">${data.intro || ''}</div>

    <!-- 장점 (크게) -->
    <div class="bg-green-50 border border-green-100 rounded-xl p-6 mb-4">
      <h3 class="font-bold text-green-700 mb-4 text-base">👍 이런 점이 좋았어요</h3>
      <ul class="space-y-2.5 text-sm text-ink-700">${prosHTML}</ul>
    </div>

    <!-- 아쉬운 점 (작게, 눈에 안 띄게) -->
    <details class="mb-8">
      <summary class="text-xs text-ink-300 cursor-pointer select-none hover:text-ink-400 transition-colors">🤔 굳이 꼽자면 아쉬운 점</summary>
      <div class="mt-2 pl-3 border-l border-ink-100">
        <ul class="space-y-1.5 text-xs text-ink-300">${consHTML}</ul>
      </div>
    </details>

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
      // │(U+2502 박스문자), ｜(U+FF5C 전각), | (U+007C 일반) 모두 허용
      const parts = line.replace(/[│｜]/g, '|').split('|');
      const affiliateUrl = parts[0]?.trim();
      const platform = (parts[1]?.trim() || 'coupang').toLowerCase();
      const field3 = parts[2]?.trim() || '';
      const field4 = parts[3]?.trim() || '';   // 가격 (예: 4,869,000원)
      const field5 = parts[4]?.trim() || '';   // 이미지 URLs (쉼표 구분)

      // 3번째 필드가 URL이 아니면 제품명으로 자동 처리
      const isUrl = field3.startsWith('http://') || field3.startsWith('https://');
      const scrapeUrl = isUrl ? field3 : null;
      const manualName = isUrl ? '' : field3;
      const manualPrice = field4;
      const manualImages = field5 ? field5.split(',').map(u => u.trim()).filter(Boolean) : [];

      if (!affiliateUrl) continue;

      try {
        const data = await generateProductReview(affiliateUrl, platform, scrapeUrl, manualName, manualPrice, manualImages);
        const html = buildProductReviewHTML(data);
        savePost(data, html);
        updateIndexHTML(data);
        updateSitemap(data);
        console.log(`\n✅ [제품리뷰] 완료: ${data.title}`);
        await sleep(3000);
      } catch (e) {
        console.error(`\n❌ [제품리뷰] 실패 (${affiliateUrl}):`, e.message);
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
