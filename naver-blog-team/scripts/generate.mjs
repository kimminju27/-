/**
 * 네이버 블로그 정보성 글 + 카드뉴스 자동 생성 (v3)
 *
 * 흐름:
 *   Google News RSS → Groq API(글 생성) → SVG 카드뉴스 8장(1080×1440) 생성 → PNG 변환 → drafts/ 저장
 *
 * 카드 구성:
 *   card-01 Hero(표지) → card-02 상황설명 → card-03 핵심정보① → card-04 핵심정보②(비교)
 *   → card-05 핵심정보③(목록) → card-06 전문가/데이터 → card-07 실전가이드 → card-08 요약+CTA
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────
// KST 날짜
// ─────────────────────────────────────────
function getKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────
// Groq API 호출
// ─────────────────────────────────────────
async function callGroq(prompt, { maxTokens = 8000, systemMsg = '', model = 'llama-3.3-70b-versatile', _retry = 0 } = {}) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY가 없습니다.');

  const messages = [];
  if (systemMsg) messages.push({ role: 'system', content: systemMsg });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    // 429 Rate limit → 65초 대기 후 최대 3회 재시도
    if (res.status === 429 && _retry < 3) {
      const waitSec = 65 * (_retry + 1);
      console.warn(`   ⏳ Groq 429 rate limit → ${waitSec}초 대기 후 재시도 (${_retry + 1}/3)...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return callGroq(prompt, { maxTokens, systemMsg, model, _retry: _retry + 1 });
    }
    throw new Error(`Groq 오류: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function repairJson(str) {
  let inString = false, escaped = false, result = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; result += ch; continue; }
    if (ch === '\\') { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

function parseJson(text) {
  const raw = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 없음');
  try { return JSON.parse(match[0]); }
  catch { return JSON.parse(repairJson(match[0])); }
}

// ─────────────────────────────────────────
// Google News RSS
// ─────────────────────────────────────────
const NEWS_QUERIES = {
  '경제': [
    '한국 경제 금리 물가 환율',
    '한국 경제 무역 수출 소비 실적',
    '한국 경제 재정 예산 세금 정책',
  ],
  '부동산': [
    '부동산 아파트 전세 청약 집값',
    '부동산 다주택 세금 양도세 규제',
    '부동산 대출 규제 담보 사기 피해',
  ],
  '주식': [
    '주식 코스피 코스닥 ETF 투자',
    '주식 실적 배당 기업 분석',
    '주식 선물 옵션 공매도 시장',
  ],
  '복지정책': [
    '정부 복지 지원금 청년 정책',
    '정부 복지 노인 육아 보육 혜택',
    '정부 복지 장애인 의료 주거 지원',
  ],
};

async function fetchNewsRSS(category, slot = 1) {
  const queries = NEWS_QUERIES[category];
  const queryStr = Array.isArray(queries)
    ? (queries[slot - 1] ?? queries[queries.length - 1])
    : (queries || category);
  const q = encodeURIComponent(queryStr);
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000),
    });
    const xml = await res.text();
    const items = [];
    for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10)) {
      const t = m[1];
      const title = (t.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || t.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
      const desc = (t.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/))?.[1]?.replace(/<[^>]*>/g, '').trim().substring(0, 200) || '';
      const pubDate = (t.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';
      if (title.length > 5) items.push({ title, desc, pubDate });
    }
    return items;
  } catch { return []; }
}

// ─────────────────────────────────────────
// 블로그 글 생성 (2단계: 카드 → 본문 분리)
// ─────────────────────────────────────────
const FOREIGN_CHAR_RE = /[\u2E80-\u2FFF\u3000-\u9FFF\uF900-\uFAFF]/;

function cleanForeignChars(text) {
  if (!text) return text;
  return text
    .replace(/[\u2E80-\u2FFF\u3000-\u9FFF\uF900-\uFAFF\u20000-\u2A6DF]/g, '')
    .replace(/[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function generateBlogContent(category, newsItems, slot = 1) {
  const today = getKSTDate();
  const newsContext = newsItems.length > 0
    ? newsItems.map((n, i) => `${i + 1}. ${n.title}${n.pubDate ? ` (${n.pubDate})` : ''}`).join('\n')
    : `${category} 관련 최신 동향`;

  const modeGuide = {
    '경제': '정책/생활 정보 모드: 고물가·환율 등 일상 체감 경험으로 시작 → 팩트체크 → 표 → 실전 팁',
    '부동산': '정책/생활 정보 모드: 전세/집값 고민 등 개인 경험으로 시작 → 정책 팩트 → 지역별 데이터 표 → 실전 가이드',
    '주식': '기업/주식 분석 모드: 일상 속 경제 체감으로 시작 → 시장 현황 → 재무/지표 표 → 리스크 정리',
    '복지정책': '정책/생활 정보 모드: 가계 부담 등 개인 소회로 시작 → 지원 정책 팩트 → 신청 조건 표 → 실천 가이드',
  };

  const baseSystemMsg = `한글/영문/숫자/특수문자/이모지만 허용. 한자·중국어·일본어 금지. valid JSON만 응답. 코드블록 없이.`;

  // ── 1단계: 제목·태그·카드 데이터 생성 (8장) ──
  console.log('   📊 [1/2] 카드 데이터 생성...');
  const cardPrompt = `오늘(${today}) [${category}] 정보성 블로그용 카드뉴스 데이터를 생성하세요.

오늘의 뉴스:
${newsContext}

⚠️ 절대 규칙 (위반 시 무효):
1. "title": 반드시 구체적 수치 포함. 예) "2026년 코스피 2,580p 돌파 — ETF 투자 전략 총정리"
2. '%' 단독 사용 절대 금지. 반드시 숫자와 함께: 3.5%, +1.2%, 12% 형태로만
3. card4 rows의 "left"/"right": "수치/값" 그대로 두지 말고 실제 수치로 채울 것. 뉴스에 없으면 해당 분야 실제 시장 데이터 사용
4. card6 stats의 "value": 실제 수치 입력. 예) "2,580pt", "+3.2%", "15조 원", "연 5.0%"
5. 연도/월/일은 반드시 아라비아 숫자: 2026년 4월 22일

가장 실용적인 이슈 하나를 선택해 아래 JSON으로만 응답:
{
  "title": "SEO 제목(55-70자, 구체적 수치 포함, 롱테일 키워드)",
  "description": "메타설명 80-100자",
  "tags": ["태그1","태그2","태그3","태그4","태그5","태그6","태그7","태그8","태그9","태그10"],
  "card1": {
    "badge": "${category} · ${today}",
    "keyWord": "핵심 키워드(10자이내, 강조할 단어)",
    "keyPoints": ["→ 핵심 요약1", "→ 핵심 요약2", "→ 핵심 요약3"]
  },
  "card2": {
    "label": "상황 설명",
    "heading": "배경/문제 제목(25자이내)",
    "context": "배경 설명 한 줄(40자이내)",
    "items": [
      {"title": "현상1(12자이내)", "desc": "설명(28자이내)"},
      {"title": "현상2(12자이내)", "desc": "설명(28자이내)"},
      {"title": "현상3(12자이내)", "desc": "설명(28자이내)"}
    ],
    "highlight": "핵심 메시지(30자이내)"
  },
  "card3": {
    "label": "핵심 정보 ①",
    "heading": "첫 번째 주요 포인트 제목(25자이내)",
    "items": [
      {"title": "항목1(12자이내)", "desc": "설명(28자이내)"},
      {"title": "항목2(12자이내)", "desc": "설명(28자이내)"},
      {"title": "항목3(12자이내)", "desc": "설명(28자이내)"}
    ],
    "highlight": "강조 텍스트(30자이내)"
  },
  "card4": {
    "label": "핵심 정보 ②",
    "heading": "비교/변화 제목(25자이내)",
    "leftLabel": "이전/현재",
    "rightLabel": "이후/변화",
    "rows": [
      {"label": "항목(8자이내)", "left": "수치/값", "right": "수치/값"},
      {"label": "항목(8자이내)", "left": "수치/값", "right": "수치/값"},
      {"label": "항목(8자이내)", "left": "수치/값", "right": "수치/값"}
    ],
    "highlight": "비교 결론(30자이내)"
  },
  "card5": {
    "label": "핵심 정보 ③",
    "heading": "세 번째 포인트 제목(25자이내)",
    "items": [
      {"num": "1", "title": "항목1(10자이내)", "desc": "설명(28자이내)"},
      {"num": "2", "title": "항목2(10자이내)", "desc": "설명(28자이내)"},
      {"num": "3", "title": "항목3(10자이내)", "desc": "설명(28자이내)"},
      {"num": "4", "title": "항목4(10자이내)", "desc": "설명(28자이내)"}
    ],
    "warning": "주의사항(30자이내)"
  },
  "card6": {
    "label": "전문가 · 데이터",
    "heading": "근거 제목(25자이내)",
    "quote": "전문가/공식 인용구(50자이내)",
    "source": "출처명(20자이내)",
    "stats": [
      {"label": "지표1(10자이내)", "value": "수치/값"},
      {"label": "지표2(10자이내)", "value": "수치/값"},
      {"label": "지표3(10자이내)", "value": "수치/값"}
    ]
  },
  "card7": {
    "label": "실전 가이드",
    "heading": "실천 방법 제목(25자이내)",
    "steps": [
      {"num": "1", "title": "단계1(12자이내)", "desc": "방법(30자이내)"},
      {"num": "2", "title": "단계2(12자이내)", "desc": "방법(30자이내)"},
      {"num": "3", "title": "단계3(12자이내)", "desc": "방법(30자이내)"}
    ]
  },
  "card8": {
    "summaries": [
      {"label": "①", "title": "요약1(20자이내)", "desc": "설명(30자이내)"},
      {"label": "②", "title": "요약2(20자이내)", "desc": "설명(30자이내)"},
      {"label": "③", "title": "요약3(20자이내)", "desc": "설명(30자이내)"}
    ],
    "ctaText": "저장/공유 CTA 문구(25자이내)",
    "hashtags": "#태그1 #태그2 #태그3 #태그4 #태그5"
  }
}`;

  const cardText = await callGroq(cardPrompt, { maxTokens: 3000, systemMsg: baseSystemMsg });
  let cardData = parseJson(cardText);

  if (FOREIGN_CHAR_RE.test(JSON.stringify(cardData))) {
    console.warn('   ⚠️  카드 한자 감지 → 12초 대기 후 재생성...');
    await new Promise(r => setTimeout(r, 12000));
    cardData = parseJson(await callGroq(cardPrompt + '\n한글/영문/숫자/특수문자만 사용하세요.', { maxTokens: 3000, systemMsg: baseSystemMsg }));
  }

  // 플레이스홀더 검증 (단독 %, "수치/값" 텍스트 감지)
  const cardJson = JSON.stringify(cardData);
  const hasPlaceholder = /(?<!\d)%(?!\d)|수치\/값|^\s*%\s*$/.test(cardJson) ||
    (cardData.card4?.rows || []).some(r => !r.left || !r.right || r.left === '수치/값' || r.right === '수치/값');
  if (hasPlaceholder) {
    console.warn('   ⚠️  플레이스홀더 감지 → 12초 대기 후 재생성...');
    await new Promise(r => setTimeout(r, 12000));
    cardData = parseJson(await callGroq(
      cardPrompt + '\n\n재강조: % 단독 사용 절대 금지. 모든 수치 칸에 실제 숫자값을 채울 것. "수치/값" 텍스트 그대로 두지 말 것.',
      { maxTokens: 3000, systemMsg: baseSystemMsg }
    ));
    console.log('   ✅ 플레이스홀더 재생성 완료');
  }

  await new Promise(r => setTimeout(r, 5000));

  // ── 2단계: 블로그 본문 섹션 생성 ──
  console.log('   ✍️  [2/2] 본문 섹션 생성...');

  const sectionSystemMsg = `You are a Korean blog editor with 10 years of experience. Write ONLY in Korean (Hangul).

CRITICAL RULES - NO EXCEPTIONS:
1. Use ONLY these characters: Korean Hangul, English letters (A-Z a-z), Arabic numerals (0-9), punctuation (.,!?%+- etc), emoji
2. NEVER use Chinese characters (汉字), Japanese characters, or any CJK ideographs
3. ALL numbers MUST be Arabic numerals: 2026년, 3월, 2,580포인트, +1.3%, 15조 원
4. NEVER write numbers as Chinese/Korean characters: 이천 → write 2000, 삼십오 → write 35
5. Table cells MUST contain real numbers/values, NEVER empty or placeholder values
6. Word count requirements: intro 700+, facts 600+, detail 600+, tips 500+, outro 400+
7. Style: use ~하더라고요, ~거든요, ~인 셈이죠 (conversational Korean)
8. FORBIDDEN phrases: 알아보겠습니다, 살펴보겠습니다, 이러한, 따라서, 결론적으로`;

  const card4Rows = (cardData.card4?.rows || [])
    .map(r => `  - ${r.label}: ${r.left} → ${r.right}`)
    .join('\n');
  const card6Stats = (cardData.card6?.stats || [])
    .map(i => `  - ${i.label}: ${i.value}`)
    .join('\n');

  const sectionPrompt = `블로그 제목: "${cardData.title}"
카테고리: ${category} / ${modeGuide[category] || ''}
오늘 날짜: ${today} (반드시 아라비아 숫자 그대로: 예) 2026년 3월 27일)

━━━ 핵심 데이터 (이 수치를 본문과 표에 반드시 사용할 것) ━━━
• 비교 데이터:
${card4Rows}
• 요약 지표:
${card6Stats}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ 규칙: 모든 숫자는 아라비아 숫자로. 예) 2026년, 3월, 2,580pt, +1.3%, 15조 원
표 셀은 절대 비우지 말고 위 핵심 데이터를 기반으로 구체적인 숫자로 채울 것.

참고 뉴스:
${newsContext}

아래 5개 구분자를 정확히 사용해 각 섹션 내용을 작성하세요.
구분자 형식: ===SECTION_ID=== (반드시 이 형식 그대로)

===INTRO===
(서두: 1인칭 경험담 3~4문단, 700자 이상. 중간에 > 인용구 1개 포함. "~하더라고요", "~거든요" 구어체. 독자와 공감대 형성.)

===FACTS_HEADING===
(팩트체크 소제목: 이모지 포함, 예: 📊 2026년 3월 국내 주식 시장 — 숫자로 본 팩트)

===FACTS===
(팩트체크 본문 600자 이상. 구체적 수치 포함.
### 소제목1
설명과 마크다운 표:
| 헤더1 | 헤더2 | 헤더3 |
|------|------|------|
| 값   | 값   | 값   |
### 소제목2
설명과 마크다운 표)

===DETAIL_HEADING===
(상세 분석 소제목: 이모지 포함, 예: ⚠️ 나는 어떤 영향받나? — 대상별 상세 분석)

===DETAIL===
(상세 분석 본문 600자 이상. 독자 실생활 영향 구체적으로.
체크리스트 5개 이상:
• 항목1 설명
• 항목2 설명
주의사항/예외 케이스 포함.)

===TIPS_HEADING===
(실전 가이드 소제목: 이모지 포함, 예: 💡 지금 당장 해야 할 것 — 실전 행동 가이드)

===TIPS===
(실전 팁 500자 이상.
### 팁1 소제목
구체적 방법 (어디서, 어떻게, 언제)
### 팁2 소제목
구체적 방법)

===OUTRO_HEADING===
(마무리 소제목: 이모지 포함, 예: ✍️ 마무리 — 솔직한 한마디)

===OUTRO===
(마무리 400자 이상. 필자의 진솔한 견해. ~하더라고요, ~거든요 구어체로 자연스럽게 마무리.)`;

  let sectionRaw = await callGroq(sectionPrompt, { maxTokens: 6000, systemMsg: sectionSystemMsg });

  if (FOREIGN_CHAR_RE.test(sectionRaw)) {
    console.warn('   ⚠️  섹션 한자 감지 → 15초 대기 후 재생성...');
    await new Promise(r => setTimeout(r, 15000));
    sectionRaw = await callGroq(
      sectionPrompt + '\n\n[경고] 이전 응답에 한자/외국어가 포함되었습니다. 한글/영문/숫자/특수문자/이모지만 사용하세요.',
      { maxTokens: 6000, systemMsg: sectionSystemMsg }
    );
    console.log('   ✅ 섹션 재생성 완료');
  }

  const sections = parseSections(sectionRaw).map(s => ({
    ...s,
    heading: cleanForeignChars(s.heading),
    content: cleanForeignChars(s.content),
  }));

  const cleanCardData = deepClean(cardData);
  return { ...cleanCardData, sections };
}

function deepClean(obj) {
  if (typeof obj === 'string') return cleanForeignChars(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) result[k] = deepClean(v);
    return result;
  }
  return obj;
}

function parseSections(raw) {
  const extract = (key) => {
    const re = new RegExp(`===\\s*${key}\\s*===([\\s\\S]*?)(?====|$)`, 'i');
    return raw.match(re)?.[1]?.trim() || '';
  };
  return [
    { id: 'intro',  heading: '',                            content: extract('INTRO') },
    { id: 'facts',  heading: extract('FACTS_HEADING'),      content: extract('FACTS') },
    { id: 'detail', heading: extract('DETAIL_HEADING'),     content: extract('DETAIL') },
    { id: 'tips',   heading: extract('TIPS_HEADING'),       content: extract('TIPS') },
    { id: 'outro',  heading: extract('OUTRO_HEADING'),      content: extract('OUTRO') },
  ];
}

// ─────────────────────────────────────────
// SVG 텍스트 줄 나누기 (한국어 최적화)
// ─────────────────────────────────────────
function splitSvgText(text, maxChars = 17) {
  if (!text) return [''];
  const lines = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (current.length >= maxChars) { lines.push(current); current = ''; }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────
// 카드뉴스 SVG 생성 (v3 — 세로형 1080×1440, Navy+Gold 디자인)
// ─────────────────────────────────────────
const CW = 1080, CH = 1440, MX = 72;
const C = {
  navy: '#1A2A4A', gold: '#F5A623', white: '#FFFFFF',
  offWhite: '#F9FAFB', light: '#EEF2FF',
  text: '#111827', textMid: '#374151', textSub: '#6B7280', border: '#E5E7EB',
  red: '#DC2626', redLight: '#FEF2F2', blue: '#1D4ED8', blueLight: '#EFF6FF',
};
const F = "'Noto Sans KR',Arial,sans-serif";

function svgOpen(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
  <rect width="${CW}" height="${CH}" fill="${bg}"/>
  <rect x="0" y="0" width="${CW}" height="10" fill="${C.gold}"/>`;
}

function svgBadge(text) {
  const w = Math.min([...text].length * 13 + 40, 340);
  return `  <rect x="${MX}" y="36" width="${w}" height="44" rx="22" fill="${C.navy}" opacity="0.12"/>
  <rect x="${MX}" y="36" width="${w}" height="44" rx="22" fill="none" stroke="${C.gold}" stroke-width="1.5" opacity="0.6"/>
  <text x="${MX + w / 2}" y="64" font-family="${F}" font-size="20" font-weight="700" fill="${C.navy}" text-anchor="middle">${escXml(text)}</text>`;
}

function svgBadgeWhite(text) {
  const w = Math.min([...text].length * 13 + 40, 340);
  return `  <rect x="${MX}" y="36" width="${w}" height="44" rx="22" fill="${C.white}" opacity="0.12"/>
  <rect x="${MX}" y="36" width="${w}" height="44" rx="22" fill="none" stroke="${C.gold}" stroke-width="1.5" opacity="0.6"/>
  <text x="${MX + w / 2}" y="64" font-family="${F}" font-size="20" font-weight="700" fill="${C.white}" text-anchor="middle">${escXml(text)}</text>`;
}

function svgPageNum(n, total = '08', fill = C.gold) {
  return `  <text x="1008" y="65" font-family="${F}" font-size="22" font-weight="700" fill="${fill}" text-anchor="end">${String(n).padStart(2, '0')} / ${total}</text>`;
}

function svgSectionLabel(text, y, color = C.gold) {
  return `  <text x="${MX}" y="${y}" font-family="${F}" font-size="24" font-weight="700" fill="${color}" letter-spacing="2">${escXml(text)}</text>
  <rect x="${MX}" y="${y + 10}" width="80" height="4" rx="2" fill="${color}"/>`;
}

function svgAccentBox(x, y, w, h, rx = 16, bg = C.offWhite, barColor = C.gold) {
  return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${bg}"/>
  <rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${barColor}"/>`;
}

function svgGoldLine(y, w = 380, x = MX) {
  return `  <rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${C.gold}" opacity="0.5"/>`;
}

function svgFooter(source, lineColor = C.border, textColor = C.textSub) {
  return `  <rect x="${MX}" y="1370" width="936" height="1" fill="${lineColor}"/>
  <text x="540" y="1404" font-family="${F}" font-size="22" fill="${textColor}" text-anchor="middle">${escXml(source)}</text>`;
}

// card-01: 히어로 표지 — Navy 배경
function generateCard01(data, category, date) {
  const badge = data.card1?.badge || `${category} · ${date}`;
  const title = data.title || '';
  const keyWord = data.card1?.keyWord || '';
  const keyPoints = (data.card1?.keyPoints || []).slice(0, 3);
  const titleLines = splitSvgText(title, 17);
  const titleStartY = keyWord ? 300 : 240;
  const titleEndY = titleStartY + Math.min(titleLines.length, 2) * 88;
  const pointsStartY = titleEndY + 90;

  return `${svgOpen(C.navy)}
  <circle cx="980" cy="200" r="320" fill="${C.gold}" opacity="0.04"/>
  <circle cx="100" cy="1300" r="250" fill="${C.gold}" opacity="0.03"/>

${svgBadgeWhite(badge)}
${svgPageNum(1, '08', C.gold)}

  <text x="${MX}" y="172" font-family="${F}" font-size="24" font-weight="700" fill="${C.gold}" letter-spacing="2">TODAY'S ISSUE</text>
  <rect x="${MX}" y="182" width="80" height="4" rx="2" fill="${C.gold}"/>

${keyWord ? `  <text x="${MX}" y="258" font-family="${F}" font-size="56" font-weight="900" fill="${C.gold}">${escXml(keyWord)}</text>` : ''}

  ${titleLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${titleStartY + i * 88}" font-family="${F}" font-size="80" font-weight="900" fill="${C.white}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(titleEndY + 10, 360)}

  ${keyPoints.map((p, i) =>
    `<text x="${MX}" y="${pointsStartY + i * 64}" font-family="${F}" font-size="30" fill="${C.white}" opacity="0.88">${escXml(p)}</text>`
  ).join('\n  ')}

  <text x="${MX}" y="1060" font-family="${F}" font-size="26" fill="${C.gold}" opacity="0.75">스와이프하여 확인 →</text>

${svgFooter(date + ' 기준 정보', C.gold + '33', C.white + '66')}
</svg>`;
}

// card-02: 상황 설명 — White 배경
function generateCard02(data, date) {
  const c = data.card2 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '상황 설명';
  const heading = c.heading || '배경과 현황';
  const context = c.context || '';
  const items = (c.items || []).slice(0, 3);
  const highlight = c.highlight || '';
  const hLines = splitSvgText(heading, 17);

  return `${svgOpen(C.white)}
${svgBadge(badge)}
${svgPageNum(2)}
${svgSectionLabel(label, 160)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  <text x="${MX}" y="${236 + Math.min(hLines.length, 2) * 80 + 76}" font-family="${F}" font-size="28" fill="${C.textSub}">${escXml(context)}</text>

  ${items.map((item, i) => {
    const y = 490 + i * 170;
    return `${svgAccentBox(MX, y, 936, 140)}
  <text x="112" y="${y + 54}" font-family="${F}" font-size="36" font-weight="700" fill="${C.text}">${escXml(item.title || '')}</text>
  <text x="112" y="${y + 104}" font-family="${F}" font-size="28" fill="${C.textMid}">${escXml(item.desc || '')}</text>`;
  }).join('\n')}

  <rect x="${MX}" y="1010" width="936" height="110" rx="16" fill="${C.navy}"/>
  <text x="540" y="1076" font-family="${F}" font-size="30" font-weight="700" fill="${C.white}" text-anchor="middle">${escXml(highlight)}</text>

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-03: 핵심 정보 ① — White 배경
function generateCard03(data, date) {
  const c = data.card3 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '핵심 정보 ①';
  const heading = c.heading || '주요 내용';
  const items = (c.items || []).slice(0, 3);
  const highlight = c.highlight || '';
  const hLines = splitSvgText(heading, 17);

  return `${svgOpen(C.white)}
${svgBadge(badge)}
${svgPageNum(3)}
${svgSectionLabel(label, 160)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  ${items.map((item, i) => {
    const y = 500 + i * 195;
    return `${svgAccentBox(MX, y, 936, 160)}
  <text x="112" y="${y + 62}" font-family="${F}" font-size="36" font-weight="700" fill="${C.text}">${escXml(item.title || '')}</text>
  <text x="112" y="${y + 116}" font-family="${F}" font-size="28" fill="${C.textMid}">${escXml(item.desc || '')}</text>`;
  }).join('\n')}

  <rect x="${MX}" y="1090" width="936" height="110" rx="16" fill="${C.navy}"/>
  <text x="540" y="1156" font-family="${F}" font-size="30" font-weight="700" fill="${C.gold}" text-anchor="middle">${escXml(highlight)}</text>

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-04: 핵심 정보 ② (비교) — White 배경
function generateCard04(data, date) {
  const c = data.card4 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '핵심 정보 ②';
  const heading = c.heading || '비교 분석';
  const leftLabel = c.leftLabel || '이전';
  const rightLabel = c.rightLabel || '이후';
  const rows = (c.rows || []).slice(0, 3);
  const highlight = c.highlight || '';
  const hLines = splitSvgText(heading, 17);
  const tableY = 236 + Math.min(hLines.length, 2) * 80 + 60;

  return `${svgOpen(C.white)}
${svgBadge(badge)}
${svgPageNum(4)}
${svgSectionLabel(label, 160)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  <rect x="${MX}" y="${tableY}" width="444" height="60" rx="10" fill="${C.navy}"/>
  <text x="${MX + 222}" y="${tableY + 39}" font-family="${F}" font-size="28" font-weight="700" fill="${C.white}" text-anchor="middle">${escXml(leftLabel)}</text>
  <rect x="564" y="${tableY}" width="444" height="60" rx="10" fill="${C.gold}"/>
  <text x="786" y="${tableY + 39}" font-family="${F}" font-size="28" font-weight="700" fill="${C.navy}" text-anchor="middle">${escXml(rightLabel)}</text>

  ${rows.map((row, i) => {
    const y = tableY + 80 + i * 128;
    const bg = i % 2 === 0 ? C.offWhite : C.white;
    return `<rect x="${MX}" y="${y}" width="936" height="108" rx="12" fill="${bg}"/>
  <rect x="${MX}" y="${y}" width="936" height="108" rx="12" fill="none" stroke="${C.border}" stroke-width="1"/>
  <text x="294" y="${y + 62}" font-family="${F}" font-size="36" font-weight="700" fill="${C.navy}" text-anchor="middle">${escXml(row.left || '')}</text>
  <text x="540" y="${y + 62}" font-family="${F}" font-size="24" fill="${C.textSub}" text-anchor="middle">${escXml(row.label || '')}</text>
  <text x="786" y="${y + 62}" font-family="${F}" font-size="36" font-weight="700" fill="${C.gold}" text-anchor="middle">${escXml(row.right || '')}</text>`;
  }).join('\n')}

  <rect x="${MX}" y="${tableY + 80 + rows.length * 128 + 20}" width="936" height="110" rx="16" fill="${C.navy}"/>
  <text x="540" y="${tableY + 80 + rows.length * 128 + 86}" font-family="${F}" font-size="30" font-weight="700" fill="${C.white}" text-anchor="middle">${escXml(highlight)}</text>

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-05: 핵심 정보 ③ (번호 목록) — Light 배경
function generateCard05(data, date) {
  const c = data.card5 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '핵심 정보 ③';
  const heading = c.heading || '주요 항목';
  const items = (c.items || []).slice(0, 4);
  const warning = c.warning || '';
  const hLines = splitSvgText(heading, 17);

  return `${svgOpen(C.light)}
${svgBadge(badge)}
${svgPageNum(5)}
${svgSectionLabel(label, 160)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  ${items.map((item, i) => {
    const y = 470 + i * 158;
    return `<rect x="${MX}" y="${y}" width="60" height="60" rx="30" fill="${C.navy}"/>
  <text x="${MX + 30}" y="${y + 42}" font-family="${F}" font-size="30" font-weight="900" fill="${C.gold}" text-anchor="middle">${escXml(item.num || String(i + 1))}</text>
  <text x="154" y="${y + 36}" font-family="${F}" font-size="36" font-weight="700" fill="${C.text}">${escXml(item.title || '')}</text>
  <text x="${MX}" y="${y + 100}" font-family="${F}" font-size="26" fill="${C.textMid}">${escXml(item.desc || '')}</text>`;
  }).join('\n')}

${warning ? `  <rect x="${MX}" y="1132" width="936" height="110" rx="16" fill="${C.redLight}"/>
  <rect x="${MX}" y="1132" width="8" height="110" rx="4" fill="${C.red}"/>
  <text x="112" y="1198" font-family="${F}" font-size="28" font-weight="700" fill="${C.red}">⚠️ ${escXml(warning)}</text>` : ''}

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-06: 전문가/데이터 — White 배경
function generateCard06(data, date) {
  const c = data.card6 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '전문가 · 데이터';
  const heading = c.heading || '근거와 통계';
  const quote = c.quote || '';
  const source = c.source || '';
  const stats = (c.stats || []).slice(0, 3);
  const hLines = splitSvgText(heading, 17);

  return `${svgOpen(C.white)}
${svgBadge(badge)}
${svgPageNum(6)}
${svgSectionLabel(label, 160)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  <rect x="${MX}" y="480" width="936" height="190" rx="16" fill="${C.light}"/>
  <rect x="${MX}" y="480" width="8" height="190" rx="4" fill="${C.gold}"/>
  <text x="112" y="550" font-family="${F}" font-size="26" fill="${C.textSub}" font-style="italic">❝</text>
  <text x="112" y="588" font-family="${F}" font-size="30" font-weight="700" fill="${C.text}">${escXml(quote)}</text>
  <text x="112" y="640" font-family="${F}" font-size="24" fill="${C.textSub}">— ${escXml(source)}</text>

  ${stats.map((stat, i) => {
    const x = MX + i * 316;
    const w = 300;
    return `<rect x="${x}" y="720" width="${w}" height="190" rx="16" fill="${C.offWhite}"/>
  <rect x="${x}" y="720" width="${w}" height="6" rx="3" fill="${C.gold}"/>
  <text x="${x + w / 2}" y="830" font-family="${F}" font-size="52" font-weight="900" fill="${C.navy}" text-anchor="middle">${escXml(stat.value || '')}</text>
  <text x="${x + w / 2}" y="880" font-family="${F}" font-size="24" fill="${C.textSub}" text-anchor="middle">${escXml(stat.label || '')}</text>`;
  }).join('\n')}

  <rect x="${MX}" y="960" width="936" height="110" rx="16" fill="${C.navy}"/>
  <text x="540" y="1026" font-family="${F}" font-size="28" font-weight="700" fill="${C.white}" text-anchor="middle">정확한 정보로 현명한 판단을 내리세요</text>

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-07: 실전 가이드 — White/Blue 테마
function generateCard07(data, date) {
  const c = data.card7 || {};
  const badge = data.card1?.badge || date;
  const label = c.label || '실전 가이드';
  const heading = c.heading || '지금 바로 실천하기';
  const steps = (c.steps || []).slice(0, 3);
  const hLines = splitSvgText(heading, 17);

  return `${svgOpen(C.white)}
${svgBadge(badge)}
${svgPageNum(7)}
${svgSectionLabel(label, 160, C.blue)}

  ${hLines.slice(0, 2).map((line, i) =>
    `<text x="${MX}" y="${236 + i * 80}" font-family="${F}" font-size="68" font-weight="900" fill="${C.text}">${escXml(line)}</text>`
  ).join('\n  ')}

${svgGoldLine(236 + Math.min(hLines.length, 2) * 80 + 16, 400)}

  ${steps.map((step, i) => {
    const y = 480 + i * 240;
    return `<rect x="${MX}" y="${y}" width="936" height="210" rx="16" fill="${C.blueLight}"/>
  <rect x="${MX}" y="${y}" width="8" height="210" rx="4" fill="${C.blue}"/>
  <rect x="112" y="${y + 30}" width="60" height="60" rx="30" fill="${C.blue}"/>
  <text x="142" y="${y + 72}" font-family="${F}" font-size="30" font-weight="900" fill="${C.white}" text-anchor="middle">${escXml(step.num || String(i + 1))}</text>
  <text x="194" y="${y + 74}" font-family="${F}" font-size="36" font-weight="700" fill="${C.text}">${escXml(step.title || '')}</text>
  <text x="112" y="${y + 154}" font-family="${F}" font-size="28" fill="${C.textMid}">${escXml(step.desc || '')}</text>`;
  }).join('\n')}

${svgFooter(date + ' 기준 정보')}
</svg>`;
}

// card-08: 요약 + CTA — Navy 배경
function generateCard08(data, date) {
  const c = data.card8 || {};
  const summaries = (c.summaries || []).slice(0, 3);
  const ctaText = c.ctaText || '저장해두고 나중에 확인하세요';
  const hashtags = c.hashtags || '';

  return `${svgOpen(C.navy)}
  <circle cx="980" cy="200" r="320" fill="${C.gold}" opacity="0.04"/>
  <circle cx="100" cy="1300" r="250" fill="${C.gold}" opacity="0.03"/>

  <text x="1008" y="68" font-family="${F}" font-size="22" font-weight="700" fill="${C.gold}" text-anchor="end" opacity="0.6">08 / 08</text>

  <text x="${MX}" y="162" font-family="${F}" font-size="52" font-weight="900" fill="${C.gold}">핵심 정리</text>
  <rect x="${MX}" y="180" width="936" height="2" fill="${C.gold}" opacity="0.3"/>

  ${summaries.map((s, i) => {
    const y = 212 + i * 196;
    return `<rect x="${MX}" y="${y}" width="936" height="168" rx="16" fill="${C.white}" opacity="0.06"/>
  <rect x="${MX}" y="${y}" width="8" height="168" rx="4" fill="${C.gold}"/>
  <text x="102" y="${y + 58}" font-family="${F}" font-size="30" font-weight="900" fill="${C.gold}">${escXml(s.label || '')} ${escXml(s.title || '')}</text>
  <text x="102" y="${y + 108}" font-family="${F}" font-size="26" fill="${C.white}" opacity="0.85">${escXml(s.desc || '')}</text>`;
  }).join('\n  ')}

  <rect x="${MX}" y="810" width="936" height="172" rx="20" fill="${C.gold}"/>
  <text x="540" y="886" font-family="${F}" font-size="32" font-weight="700" fill="${C.navy}" text-anchor="middle">💾 ${escXml(ctaText)}</text>
  <text x="540" y="948" font-family="${F}" font-size="28" font-weight="700" fill="${C.navy}" text-anchor="middle">🔁 주변에 공유해서 도움을 나눠요</text>

  <text x="540" y="1042" font-family="${F}" font-size="24" fill="${C.white}" opacity="0.5" text-anchor="middle">${escXml(hashtags)}</text>

  <rect x="${MX}" y="1340" width="936" height="1" fill="${C.gold}" opacity="0.2"/>
  <text x="540" y="1386" font-family="${F}" font-size="22" fill="${C.white}" opacity="0.5" text-anchor="middle">${escXml(date)} 기준 정보</text>
</svg>`;
}

// ─────────────────────────────────────────
// SVG → PNG 변환 (Playwright)
// ─────────────────────────────────────────
async function svgToPng(svgContent, outputPath, width = 1080, height = 1440) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#000;">
${svgContent}
</body></html>`;

  await page.setContent(html);
  await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width, height } });
  await browser.close();
}

// ─────────────────────────────────────────
// 마크다운 표 → HTML 변환
// ─────────────────────────────────────────
function convertTable(content) {
  if (!content.includes('|')) return content;
  const lines = content.split('\n');
  let result = '';
  let inTable = false;
  let tableHtml = '';
  let isHeader = true;

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      if (line.includes('---')) { isHeader = false; continue; }
      if (!inTable) { inTable = true; tableHtml = '<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;">'; }
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      const tag = isHeader ? 'th' : 'td';
      const style = isHeader
        ? 'background:#1A2A4A;color:#F5A623;padding:12px;border:1px solid #ddd;text-align:center;font-weight:bold;'
        : 'padding:10px;border:1px solid #ddd;text-align:center;color:#333;';
      tableHtml += `<tr>${cells.map(c => `<${tag} style="${style}">${c}</${tag}>`).join('')}</tr>`;
      if (isHeader) isHeader = false;
    } else {
      if (inTable) { result += tableHtml + '</table>\n'; inTable = false; isHeader = true; tableHtml = ''; }
      result += line + '\n';
    }
  }
  if (inTable) result += tableHtml + '</table>\n';
  return result;
}

// ─────────────────────────────────────────
// JSON → 네이버 블로그용 HTML 변환
// ─────────────────────────────────────────
export function buildNaverHtml(post, cardPaths) {
  let html = '';
  const sections = post.sections || [];

  for (const section of sections) {
    // intro 앞: card-01 (히어로)
    if (section.id === 'intro' && cardPaths[0]) {
      html += `<div style="text-align:center;margin:20px 0;"><img src="${cardPaths[0]}" style="max-width:100%;border-radius:12px;" alt="${escXml(post.title)} 카드뉴스"></div>\n<br>\n`;
    }

    if (section.heading) {
      html += `<h3 style="font-size:20px;font-weight:bold;color:#1a1a1a;border-left:5px solid #F5A623;padding-left:14px;margin:32px 0 14px;">${section.heading}</h3>\n`;
    }

    const contentHtml = convertTable(section.content || '');
    const paras = contentHtml.split('\n').filter(l => l.trim());
    for (const para of paras) {
      if (para.startsWith('<table')) { html += para + '\n'; continue; }
      if (para.startsWith('|') || para.startsWith('---')) continue;
      if (para.startsWith('&gt;') || para.startsWith('>')) {
        const quoteText = para.replace(/^&gt;\s*/, '').replace(/^>\s*/, '');
        html += `<blockquote style="border-left:4px solid #F5A623;padding:12px 16px;background:#EEF2FF;color:#555;margin:16px 0;font-style:italic;">${quoteText}</blockquote>\n`;
        continue;
      }
      if (para.match(/^- \[[ x]\]/)) {
        html += `<p style="font-size:16px;line-height:1.9;color:#333;margin:0 0 8px;">✅ ${para.replace(/^- \[[ x]\]\s*/, '')}</p>\n`;
        continue;
      }
      html += `<p style="font-size:16px;line-height:1.9;color:#333;margin:0 0 14px;">${para}</p>\n`;
    }
    html += '<br>\n';

    // 섹션 다음 카드 삽입
    if (section.id === 'facts' && cardPaths[2]) {
      html += `<div style="text-align:center;margin:24px 0;"><img src="${cardPaths[2]}" style="max-width:100%;border-radius:12px;" alt="핵심 정보 카드뉴스"></div>\n<br>\n`;
    }
    if (section.id === 'detail' && cardPaths[4]) {
      html += `<div style="text-align:center;margin:24px 0;"><img src="${cardPaths[4]}" style="max-width:100%;border-radius:12px;" alt="핵심 정보 카드뉴스"></div>\n<br>\n`;
    }
    if (section.id === 'tips' && cardPaths[6]) {
      html += `<div style="text-align:center;margin:24px 0;"><img src="${cardPaths[6]}" style="max-width:100%;border-radius:12px;" alt="실전 가이드 카드뉴스"></div>\n<br>\n`;
    }
    if (section.id === 'outro' && cardPaths[7]) {
      html += `<div style="text-align:center;margin:24px 0;"><img src="${cardPaths[7]}" style="max-width:100%;border-radius:12px;" alt="요약 카드뉴스"></div>\n<br>\n`;
    }
  }

  html += `<hr style="border:none;border-top:1px solid #eee;margin:32px 0;">\n`;
  html += `<p style="font-size:13px;color:#999;text-align:right;">${post.date} 기준 정보입니다.</p>\n`;
  return html;
}

// ─────────────────────────────────────────
// 메인: 전체 생성
// ─────────────────────────────────────────
export async function generateAll(categories, slot = 1) {
  const draftsDir = path.join(ROOT, 'drafts');
  const cardNewsDir = path.join(ROOT, 'card-news');
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true });
  if (!existsSync(cardNewsDir)) mkdirSync(cardNewsDir, { recursive: true });

  const results = [];
  const slotSuffix = slot > 1 ? `-${slot}` : '';

  for (const category of categories) {
    console.log(`\n📝 [${category}] 생성 시작... (슬롯 ${slot})`);
    try {
      // 1. 뉴스 수집
      const newsItems = await fetchNewsRSS(category, slot);
      console.log(`   📡 뉴스 ${newsItems.length}건 수집`);

      // 2. 블로그 글 생성
      const post = await generateBlogContent(category, newsItems, slot);
      post.date = getKSTDate();
      post.category = category;
      console.log(`   ✅ 글 생성 완료: ${post.title}`);

      // 3. SVG 카드뉴스 8장 생성
      const cardSvgs = [
        generateCard01(post, category, post.date),
        generateCard02(post, post.date),
        generateCard03(post, post.date),
        generateCard04(post, post.date),
        generateCard05(post, post.date),
        generateCard06(post, post.date),
        generateCard07(post, post.date),
        generateCard08(post, post.date),
      ];

      // SVG → card-news/ 덮어쓰기
      const svgPaths = cardSvgs.map((_, i) =>
        path.join(cardNewsDir, `card-0${i + 1}.svg`)
      );
      cardSvgs.forEach((svg, i) => writeFileSync(svgPaths[i], svg, 'utf-8'));
      console.log('   🎨 SVG 8장 → card-news/ 저장');

      // PNG → drafts/ 저장
      const pngPaths = cardSvgs.map((_, i) =>
        path.join(draftsDir, `${post.date}-${category}${slotSuffix}-card${String(i + 1).padStart(2, '0')}.png`)
      );
      console.log('   🖼️  PNG 변환 중...');
      for (let i = 0; i < cardSvgs.length; i++) {
        await svgToPng(cardSvgs[i], pngPaths[i]);
      }
      console.log('   ✅ PNG 변환 완료 (8장)');

      // 4. 네이버 HTML 빌드
      post.cardPngPaths = pngPaths;
      post.htmlContent = buildNaverHtml(post, pngPaths);
      post.generatedAt = new Date().toISOString();

      // 5. JSON 저장
      const jsonPath = path.join(draftsDir, `${post.date}-${category}${slotSuffix}-draft.json`);
      writeFileSync(jsonPath, JSON.stringify(post, null, 2), 'utf-8');

      console.log(`   💾 저장: drafts/${path.basename(jsonPath)}`);
      console.log(`   🏷️  태그: ${post.tags?.slice(0, 5).join(', ')}... (${post.tags?.length || 0}개)`);

      results.push({ category, post, filepath: jsonPath });
    } catch (e) {
      console.error(`   ❌ [${category}] 실패:`, e.message);
      results.push({ category, error: e.message });
    }
  }

  return results;
}

// 단독 실행
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const categories = (process.env.CATEGORIES || '경제,부동산,주식,복지정책').split(',').map(s => s.trim()).filter(Boolean);
  console.log(`\n🚀 생성 시작: [${categories.join(', ')}]`);
  await generateAll(categories);
  console.log('\n✅ 완료');
}
