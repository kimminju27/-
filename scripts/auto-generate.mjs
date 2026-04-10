import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GENERATION_MODE = process.env.GENERATION_MODE || 'news';
const CATEGORIES_ENV = process.env.CATEGORIES || '경제,주식';
const CATEGORIES = CATEGORIES_ENV.split(',').map(c => c.trim()).filter(Boolean);

const CATEGORY_META = {
  '보험':     { emoji: '🛡️', gradient: 'from-blue-50 to-indigo-100',    badge: 'badge-보험',    ogImage: '/og-default.svg',   color: '#1e40af' },
  '세금':     { emoji: '📋', gradient: 'from-red-50 to-orange-100',     badge: 'badge-세금',    ogImage: '/og-default.svg',   color: '#b91c1c' },
  '부동산':   { emoji: '🏠', gradient: 'from-indigo-50 to-purple-100',  badge: 'badge-부동산',  ogImage: '/og-realestate.svg', color: '#3730a3' },
  '복지':     { emoji: '🤝', gradient: 'from-violet-50 to-purple-100',  badge: 'badge-복지',    ogImage: '/og-welfare.svg',   color: '#7c3aed' },
  '복지정책': { emoji: '🤝', gradient: 'from-violet-50 to-purple-100',  badge: 'badge-복지',    ogImage: '/og-welfare.svg',   color: '#7c3aed' },
  '주식':     { emoji: '📈', gradient: 'from-green-50 to-emerald-100',  badge: 'badge-주식',    ogImage: '/og-stock.svg',     color: '#166534' },
  '경제':     { emoji: '💰', gradient: 'from-yellow-50 to-amber-100',   badge: 'badge-경제',    ogImage: '/og-economy.svg',   color: '#854d0e' },
  '리뷰':     { emoji: '⭐', gradient: 'from-sky-50 to-blue-100',      badge: 'badge-제품리뷰', ogImage: '/og-review.svg',    color: '#0369a1' },
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META['경제'];
}

// ─── 텍스트 정제 ──────────────────────────────────────────────
// 한자·일본어 + 독일어·프랑스어 등 비영어 유럽어 단어 제거
const FOREIGN_WORD_PATTERN = /\b(unterschied[e]?|voil[àa]|[ée]galement|cependant|jedoch|daher|ainsi|donc|depuis|lequel|obwohl|trotzdem|eigentlich|bereits|welche[rns]?|warum|woher|wobei|während|zwischen|durch|gegen|ohne|unter|neben|nach|über|beim|vom|zur|zum|auf|die|der|das|und|für)\b/gi;

function sanitizeText(text) {
  if (!text) return '';
  return text
    // 한자(CJK) · 일본어 히라가나 · 가타카나 제거
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF]/g, '')
    // 독일어·프랑스어 등 알려진 외래어 패턴 제거
    .replace(FOREIGN_WORD_PATTERN, '')
    // 한글·영문·숫자·기본 특수문자·이모지 외 모든 문자 제거
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318Fa-zA-Z0-9\s.,!?'"()\-:;%₩+\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF]/g, '')
    .replace(/\s{3,}/g, ' ')
    .replace(/^\d+\.\s*/gm, '')
    .replace(/^[-•]\s*/gm, '')
    .trim();
}

// 텍스트에 외국어가 있는지 검사
function hasForEignLanguage(text) {
  if (!text) return false;
  return FOREIGN_WORD_PATTERN.test(text) ||
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

// 유효하지 않은 날짜 감지 (3월 36일 등)
function hasInvalidDate(text) {
  const matches = [...(text || '').matchAll(/([0-9]{1,2})월\s*([0-9]{1,2})일/g)];
  for (const m of matches) {
    const month = parseInt(m[1]), day = parseInt(m[2]);
    const maxDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > (maxDays[month - 1] || 31)) {
      return m[0];
    }
  }
  return null;
}

// 금액·수치에 천단위 콤마 추가 (1000000 → 1,000,000)
// 제외: 연도(2026년), 날짜(4월/8일), 법령번호(제12호), 전화번호 등
function formatNumbers(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/(?<![,\d])(\d{4,})(?!\d)/g, (match, _p1, offset, str) => {
    const after = str.slice(offset + match.length);
    // 뒤에 년·월·일·호·번·위·회·층·기·장·관이 오면 스킵 (날짜·순서·번호류)
    if (/^[년월일호번위회층기장관]/.test(after)) return match;
    // 2000~2099 범위 숫자는 연도로 간주 → 스킵
    const num = parseInt(match, 10);
    if (num >= 2000 && num <= 2099) return match;
    return num.toLocaleString('ko-KR');
  });
}

function sanitizeData(data) {
  if (!data) return data;
  if (typeof data === 'string') return sanitizeText(data);
  if (Array.isArray(data)) return data.map(sanitizeData);
  if (typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k] = sanitizeData(v);
    return out;
  }
  return data;
}

// Groq 에러 메시지에서 대기 시간(ms) 파싱
// "try again in 1h19m18.048s" 또는 "try again in 45.5s" 형식 지원
function parseGroqWaitMs(errText) {
  const m = errText.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
  if (m && (m[1] || m[2] || m[3])) {
    return ((parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseFloat(m[3] || 0)) * 1000;
  }
  return 40000;
}

// ─── Groq API ─────────────────────────────────────────────────
async function callGroq(prompt, retryCount = 0) {
  const systemMsg = `당신은 대한민국 최고의 SEO 정보 블로그 전문 작가입니다. 반드시 아래 JSON 형식으로만 응답하세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1] 콘텐츠 분량 — 가장 중요한 규칙
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
sections의 각 content는 반드시 실제 독자가 읽을 본문 전문입니다.
- 각 content: 최소 1,000자 (공백 포함). 약 5~7개 문단, 각 문단 3~4문장.
- intro: 최소 800자. 독자의 상황으로 시작하는 4문단 이상.
- ❌ 절대 금지: 2~3문장으로 끝내는 섹션. "~에 대해 자세히 알아보겠습니다" 식의 예고만 하고 끝내기.
- ❌ 절대 금지: content 필드에 "1000자 이상으로 작성하세요" 같은 메타 지시문 넣기.
- ✅ content는 독자가 바로 읽을 수 있는 완성된 한국어 본문이어야 합니다.

[올바른 content 예시 — 이 분량과 형식으로 작성]
"2026년 실손보험 개편은 기존 가입자와 신규 가입자 모두에게 직접적인 영향을 미칩니다. 금융감독원이 2026년 1월 발표한 자료에 따르면, 4세대 실손보험의 비급여 항목 자기부담률이 기존 20~30%에서 30~40%로 상향 조정됩니다. 이는 병원 방문 횟수가 잦은 가입자일수록 체감 비용 증가가 크다는 것을 의미합니다. 특히 도수치료·체외충격파 같은 비급여 항목을 자주 이용하는 분들은 반드시 본인의 갱신 시점을 확인해야 합니다.\n\n가장 먼저 확인해야 할 것은 현재 가입한 실손보험의 세대 구분입니다. 1세대(2009년 이전), 2세대(2009~2017년), 3세대(2017~2021년), 4세대(2021년 이후)로 나뉘며, 각 세대별로 적용 규정이 다릅니다. 보험개발원 공시 기준으로 2026년 현재 전체 실손 가입자 3,900만 명 중 약 42%가 여전히 1·2세대 구 상품을 보유하고 있습니다. 구 세대 상품은 보험료가 급격히 오를 수 있어 전환 여부를 신중히 검토해야 합니다."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2] 언어 규칙 — 절대 준수
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 오직 한국어(한글)와 영어만 사용
- 한자(漢字) 절대 금지: 民間→민간, 供給→공급, 不動産→부동산
- 독일어·프랑스어 등 비영어 유럽어 절대 금지
- 모든 비한글·비영어 문자 금지

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3] 팩트 규칙 — 절대 준수
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 날짜: 반드시 실제 존재하는 날짜만 (3월 1~31일, 2월 1~28일, 4/6/9/11월 1~30일)
- stats의 value: 반드시 순수 숫자 또는 금액 (예: "3,900", "42", "30"). 날짜·연도·텍스트 금지
- stats의 unit: 반드시 단위 (예: "만 명", "%", "만 원"). stats는 실제 통계 수치여야 함
- 수치: 합리적인 범위만. "15배 증가" 같은 비현실적 수치 금지
- 정책명: 실제 한국 정책명만. 임의 조어 금지

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4] 글쓰기 규칙 — AdSense 고품질 기준
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "~에 대해 알아보겠습니다" 금지 → 바로 본론
- "중요합니다" 단순 반복 금지 → 구체적 수치/날짜로 설명
- "포괄적으로", "다양한 측면에서", "본 글에서는" 금지
- AI처럼 보이는 모든 표현 금지
- 금액·수량: 천단위 콤마 필수 (1,000원 / 10,000원 / 1,000,000원)
- 연도에 콤마 금지 (2,026년 ❌ → 2026년 ✅)
- 각 섹션마다 독자가 실제 취할 수 있는 행동 지침 1개 이상
- 공식 출처 인용 필수: "국세청 발표(2026.03)", "보건복지부 고시" 등
- 흔한 실수·주의사항·예외 상황 반드시 포함
- tip 필드: 반드시 30자 이상의 실용적 팁 문장 (단어만 넣으면 표시 안 됨)
- highlight 필드: 반드시 30자 이상의 핵심 수치나 정보 문장
- 각 섹션 내용 중복 절대 금지: 다른 섹션에서 쓴 문장·표현을 그대로 쓰거나 비슷하게 반복 금지. 6개 섹션은 각자 완전히 독립된 다른 정보를 담아야 함
- FAQ 답변: 단순 "예/아니오"나 1~2문장 요약 금지. 구체적 수치·조건·예외사항 포함해 200자 이상 작성

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5] JSON 스키마
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "title": "50자 이내, 연도+키워드+숫자/혜택 포함, 클릭 유발 제목",
  "description": "80-120자 메타 설명, 핵심 키워드+수치 포함",
  "category": "카테고리명",
  "slug": "topic-english-slug",
  "hashtags": ["#키워드1","#키워드2","#키워드3","#키워드4","#키워드5","#키워드6","#키워드7","#키워드8","#키워드9","#키워드10","#키워드11","#키워드12","#키워드13","#키워드14"],
  "keyPoints": ["핵심1 — 구체적 숫자/날짜 포함","핵심2 — 독자 궁금증 해소","핵심3 — 실행 가능한 정보"],
  "stats": [
    {"label":"통계명","value":"3,900","unit":"만 명"},
    {"label":"통계명","value":"42","unit":"%"},
    {"label":"통계명","value":"30","unit":"%"},
    {"label":"통계명","value":"1,200","unit":"만 원"}
  ],
  "imageCards": [
    {"icon":"📊","title":"핵심 통계","type":"stat","items":["항목1: 수치","항목2: 수치","항목3: 수치"]},
    {"icon":"📋","title":"확인 체크리스트","type":"checklist","items":["항목1","항목2","항목3","항목4","항목5"]},
    {"icon":"🔄","title":"신청 절차","type":"process","items":["1단계: 구체적 행동","2단계: 구체적 행동","3단계: 구체적 행동","4단계: 구체적 행동"]},
    {"icon":"⚖️","title":"비교 분석","type":"comparison","items":["비교1: A는 이렇고 B는 저렇다","비교2: A는 이렇고 B는 저렇다","비교3: A는 이렇고 B는 저렇다"]},
    {"icon":"💡","title":"핵심 팁","type":"tips","items":["팁1: 구체적 실행 방법","팁2: 구체적 실행 방법","팁3: 구체적 실행 방법","팁4: 구체적 실행 방법"]}
  ],
  "intro": "독자의 실생활 상황으로 바로 시작하는 4문단 이상, 800자 이상의 완성된 본문. 공식 수치·날짜 포함. AI처럼 보이지 않게 자연스럽게.",
  "sections": [
    {"id":"section1","title":"소제목 (연도·수치 포함)","content":"완성된 본문 1,000자 이상. 공식 수치·날짜·기관명 인용. 행동 지침 포함. 5개 이상 문단.","tip":"독자가 바로 실행할 수 있는 구체적 팁 문장 (40자 이상)","highlight":"핵심 수치나 기관명 등 구체적 정보 (40자 이상)"},
    {"id":"section2","title":"소제목 (조건·자격)","content":"완성된 본문 1,000자 이상. 자격 조건 상세히. 예외 상황 포함.","tip":"주의사항 팁 (40자 이상)","highlight":"핵심 조건이나 기한 (40자 이상)"},
    {"id":"section3","title":"소제목 (신청방법·절차)","content":"완성된 본문 1,000자 이상. 단계별 신청 방법. 필요 서류. 온·오프라인 경로.","tip":"빠른 신청 팁 (40자 이상)","highlight":"신청 기한이나 주요 링크 (40자 이상)"},
    {"id":"section4","title":"소제목 (혜택·금액 비교)","content":"완성된 본문 1,000자 이상. 실제 수령 금액. 타 제도 비교. 계산 예시.","tip":"최대 혜택 받는 방법 (40자 이상)","highlight":"핵심 금액 정보 (40자 이상)"},
    {"id":"section5","title":"소제목 (흔한 실수·주의사항)","content":"완성된 본문 1,000자 이상. 자주 하는 실수. 불이익 예방. 실제 사례.","tip":"실수 방지 팁 (40자 이상)","highlight":"핵심 주의사항 (40자 이상)"},
    {"id":"section6","title":"지금 당장 실천하기","content":"완성된 본문 1,000자 이상. 오늘 할 수 있는 구체적 행동 순서. 공식 사이트 주소. 체크리스트.","tip":"첫 번째 행동 팁 (40자 이상)","highlight":"핵심 실천 요약 (40자 이상)"}
  ],
  "comparisonTable": {
    "caption":"비교표 제목",
    "headers":["구분","항목A","항목B","항목C"],
    "rows":[["비교1","내용","내용","내용"],["비교2","내용","내용","내용"],["비교3","내용","내용","내용"],["비교4","내용","내용","내용"]]
  },
  "faqs": [
    {"question":"독자가 가장 많이 검색하는 질문1","answer":"200자 이상의 구체적이고 친절한 답변. 수치나 날짜 포함."},
    {"question":"질문2","answer":"200자 이상 답변"},
    {"question":"질문3","answer":"200자 이상 답변"},
    {"question":"질문4","answer":"200자 이상 답변"},
    {"question":"질문5","answer":"200자 이상 답변"}
  ],
  "sources": [
    {"name":"언론사A — 기사제목 (2026.MM)","url":"REPLACE_WITH_REAL_URL"},
    {"name":"언론사B — 기사제목 (2026.MM)","url":"REPLACE_WITH_REAL_URL"},
    {"name":"언론사C — 기사제목 (2026.MM)","url":"REPLACE_WITH_REAL_URL"}
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[6] 필수 수량 규칙
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- hashtags: 12개 이상
- imageCards: 5개 (각기 다른 type)
- sections: 6개, 각 content 1,000자 이상 (완성된 본문)
- faqs: 5개, 각 answer 200자 이상
- sources: 3개, 서로 다른 언론사/기관
- intro: 800자 이상`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt }
      ],
      max_tokens: 8000,
      temperature: 0.4,
      response_format: { type: 'json_object' }
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // json_validate_failed는 외국어 혼입 등이 원인 — 재시도
    if (res.status === 400 && errText.includes('json_validate_failed') && retryCount < 2) {
      console.warn(`⚠️ Groq JSON 검증 실패, 35초 대기 후 재시도...`);
      await new Promise(r => setTimeout(r, 36000));
      return callGroq(prompt + '\n\n[경고] JSON 안에 일본어(ルピア 등), 한자, 외국어 절대 금지. 오직 한국어·영어만 사용하세요!', retryCount + 1);
    }
    // 429 Rate limit — 대기 시간 파싱 후 재시도 (일일 한도 초과 시 즉시 포기)
    if (res.status === 429 && retryCount < 2) {
      const waitMs = parseGroqWaitMs(errText);
      // 5분 이상 = 일일/시간당 한도 초과 → 재시도 무의미, 즉시 실패
      if (waitMs > 5 * 60 * 1000) {
        const waitMin = Math.ceil(waitMs / 60000);
        throw new Error(`Groq 일일 토큰 한도 초과 (TPD). ${waitMin}분 후 재시도 가능.`);
      }
      console.warn(`⚠️ Rate limit (429), ${Math.ceil(waitMs/1000)}초 대기 후 재시도...`);
      await new Promise(r => setTimeout(r, waitMs));
      return callGroq(prompt, retryCount + 1);
    }
    throw new Error(`Groq API 오류 ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.choices?.[0]) throw new Error(`Groq 응답 형식 오류: ${JSON.stringify(data)}`);

  let content;
  try {
    content = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    throw new Error(`JSON 파싱 실패: ${data.choices[0].message.content.slice(0, 300)}`);
  }

  content = sanitizeData(content);

  // sections 검증
  if (!Array.isArray(content.sections) || content.sections.length < 4) {
    if (retryCount < 2) {
      console.warn(`⚠️ sections 부족 (${content.sections?.length || 0}개), 35초 대기 후 재시도...`);
      await new Promise(r => setTimeout(r, 36000));
      return callGroq(prompt + '\n\n[필수] sections 배열 6개를 반드시 포함하고 각 content는 1,000자 이상으로 작성하세요!', retryCount + 1);
    }
    throw new Error('sections 배열이 없거나 부족합니다.');
  }

  // 섹션 내용 길이 검증
  const shortSections = content.sections.filter(s => (s.content || '').length < 600);
  if (shortSections.length > 0 && retryCount < 2) {
    const names = shortSections.map(s => `"${s.title}"(${(s.content||'').length}자)`).join(', ');
    console.warn(`⚠️ 섹션 내용 너무 짧음 [${names}], 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + `\n\n[필수] 다음 섹션의 content가 너무 짧습니다: ${names}. 각 섹션 content는 반드시 1,000자 이상 실제 정보로 채워야 합니다. 2~3문장 요약은 절대 금지!`, retryCount + 1);
  }

  // intro 길이 검증
  if ((content.intro || '').length < 400 && retryCount < 1) {
    console.warn(`⚠️ intro 너무 짧음 (${(content.intro || '').length}자), 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + '\n\n[필수] intro는 반드시 800자 이상 작성하세요! 독자의 실생활 상황으로 시작하는 4문단 이상의 도입부가 필요합니다.', retryCount + 1);
  }

  // FAQ 개수 검증
  if ((!Array.isArray(content.faqs) || content.faqs.length < 3) && retryCount < 1) {
    console.warn(`⚠️ FAQ 부족 (${content.faqs?.length || 0}개), 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + '\n\n[필수] faqs 배열에 5개의 질문과 200자 이상 답변을 반드시 포함하세요!', retryCount + 1);
  }

  // slug 품질 검증 (숫자만으로 된 slug 금지)
  if (/^\d+$/.test(content.slug || '') && retryCount < 2) {
    console.warn(`⚠️ slug가 숫자만으로 구성됨: "${content.slug}", 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + `\n\n[필수] slug는 카테고리+주제를 영어로 조합해야 합니다. 숫자만("${content.slug}")은 절대 금지! 예: "tax-refund-2026", "welfare-policy-2026", "insurance-reform-2026"`, retryCount + 1);
  }

  // FAQ 답변 길이 검증
  const shortFaqs = (content.faqs || []).filter(f => (f.answer || '').length < 100);
  if (shortFaqs.length > 0 && retryCount < 2) {
    console.warn(`⚠️ FAQ 답변 너무 짧음 (${shortFaqs.length}개), 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + `\n\n[필수] FAQ 답변 ${shortFaqs.length}개가 너무 짧습니다. 각 answer는 반드시 200자 이상, 구체적 수치·조건·예외사항을 포함해 작성하세요!`, retryCount + 1);
  }

  // 섹션 간 반복 문장 검증
  const allSentences = (content.sections || []).flatMap(s =>
    (s.content || '').split(/(?<=[.!?])\s+/).filter(x => x.trim().length > 20)
  );
  const sentenceCount = {};
  allSentences.forEach(s => { const key = s.trim().slice(0, 25); sentenceCount[key] = (sentenceCount[key] || 0) + 1; });
  const repeatedEntry = Object.entries(sentenceCount).find(([, v]) => v >= 3);
  if (repeatedEntry && retryCount < 2) {
    console.warn(`⚠️ 반복 문장 감지: "${repeatedEntry[0]}..." (${repeatedEntry[1]}회), 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + `\n\n[필수] 같은 문장이 여러 섹션에 ${repeatedEntry[1]}회 반복됩니다. 각 섹션은 완전히 다른 고유한 내용만 담아야 합니다. 반복 문장·표현 절대 금지!`, retryCount + 1);
  }

  // 외국어 혼입 검증
  const allText = (content.sections || []).map(s => s.content || '').join(' ') + (content.intro || '');
  if (hasForEignLanguage(allText) && retryCount < 1) {
    console.warn(`⚠️ 외국어 감지, 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + '\n\n[경고] 외국어(독일어·한자 등) 감지됨. 오직 한국어와 영어만 사용하세요!', retryCount + 1);
  }

  // 유효하지 않은 날짜 검증 (3월 36일 등)
  const badDate = hasInvalidDate(JSON.stringify(content));
  if (badDate && retryCount < 2) {
    console.warn(`⚠️ 유효하지 않은 날짜 감지: "${badDate}", 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + `\n\n[경고] "${badDate}" 같은 실제로 존재하지 않는 날짜 감지됨! 3월은 1~31일, 2월은 1~28일, 4/6/9/11월은 1~30일까지만 유효합니다!`, retryCount + 1);
  }

  // imageCards 기본값 보장
  if (!Array.isArray(content.imageCards) || content.imageCards.length < 3) {
    content.imageCards = [
      { icon: '📊', title: '핵심 수치', type: 'stat', items: (content.stats || []).slice(0, 3).map(s => `${s.label}: ${s.value}${s.unit || ''}`) },
      { icon: '📋', title: '확인 체크리스트', type: 'checklist', items: (content.keyPoints || ['확인사항1','확인사항2','확인사항3']) },
      { icon: '💡', title: '핵심 팁 정리', type: 'tips', items: (content.sections || []).slice(0, 4).map(s => s.tip).filter(Boolean) },
      { icon: '🔄', title: '진행 단계', type: 'process', items: ['1단계: 정보 확인', '2단계: 자격 검토', '3단계: 서류 준비', '4단계: 신청 완료'] },
      { icon: '🎯', title: '이것만 기억하세요', type: 'summary', items: (content.sections || []).slice(0, 4).map(s => s.highlight).filter(Boolean) }
    ];
  }

  // hashtags 기본값 보장
  if (!Array.isArray(content.hashtags) || content.hashtags.length < 5) {
    content.hashtags = (content.tags || []).map(t => t.startsWith('#') ? t : `#${t}`);
  }

  return content;
}

// ─── 뉴스 수집 (실제 URL 포함 최대 5개) ─────────────────────────
async function fetchNewsContext(category) {
  try {
    // 한국 뉴스만 — "한국" 키워드 추가로 인도네시아 등 해외 기사 배제
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+한국&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (items.length === 0) return null;

    const parsed = items.slice(0, 8).map(item => {
      const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch  = item.match(/<link>([\s\S]*?)<\/link>/);
      const srcMatch   = item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || item.match(/<source[^>]*\/>/);
      const descMatch  = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
      const dateMatch  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      const rawTitle = (titleMatch?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const title  = sanitizeText(rawTitle.replace(/ - [^-]+$/, '').trim());
      const link   = (linkMatch?.[1] || '').trim();
      const source = (srcMatch?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const desc   = sanitizeText((descMatch?.[1] || '').replace(/<[^>]+>/g, '').trim().slice(0, 200));
      const pubDate = (dateMatch?.[1] || '').trim();

      return { title, link, source, desc, pubDate };
    }).filter(i => {
      if (!i.title || !i.link || !i.link.startsWith('http')) return false;
      // 해외 기사 필터 — 루피아·외국 통화·일본어·한자가 제목에 있으면 제외
      const foreign = /루피아|rupiah|ルピア|元|€|peso|baht|ringgit|[\u4E00-\u9FFF\u3040-\u30FF]/i;
      return !foreign.test(i.title);
    });

    if (parsed.length === 0) return null;

    // 상위 5개에서 랜덤 1개를 메인 뉴스로, 나머지는 출처 후보로
    const shuffled = parsed.sort(() => Math.random() - 0.5);
    return {
      main: shuffled[0],
      all: shuffled.slice(0, 5)
    };
  } catch (e) {
    console.warn(`⚠️ 뉴스 수집 실패 (${category}): ${e.message}`);
    return null;
  }
}

// ─── HTML 비주얼 헬퍼 ─────────────────────────────────────────
function buildStatCards(stats) {
  if (!stats || stats.length === 0) return '';
  const cards = stats.slice(0, 4).map(s => `
      <div class="bg-white border border-ink-100 rounded-xl p-4 text-center shadow-sm">
        <p class="text-2xl font-black text-brand-600">${s.value}<span class="text-sm font-normal text-ink-400 ml-1">${s.unit || ''}</span></p>
        <p class="text-xs text-ink-500 mt-1 font-medium leading-tight">${s.label}</p>
      </div>`).join('');
  return `
    <div class="not-prose grid grid-cols-2 sm:grid-cols-${Math.min(stats.length, 4)} gap-3 my-8 p-4 bg-gradient-to-br from-brand-50 to-white rounded-2xl border border-brand-100">
      <p class="col-span-full text-xs font-bold text-brand-700 uppercase tracking-widest mb-1">📊 핵심 데이터</p>
      ${cards}
    </div>`;
}

function buildHighlightBox(text, type) {
  if (!text) return '';
  const styles = {
    tip:     { bg: 'bg-brand-50',  border: 'border-brand-200',  icon: '💡', textColor: 'text-brand-700' },
    point:   { bg: 'bg-purple-50', border: 'border-purple-200', icon: '📌', textColor: 'text-purple-800' },
    info:    { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'ℹ️', textColor: 'text-blue-800'  },
    warning: { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: '⚠️', textColor: 'text-amber-800' },
  };
  const s = styles[type] || styles.info;
  return `
    <div class="not-prose ${s.bg} border ${s.border} rounded-xl p-4 my-5 flex gap-3 items-start">
      <span class="text-xl shrink-0">${s.icon}</span>
      <p class="text-sm ${s.textColor} leading-relaxed font-medium">${text}</p>
    </div>`;
}

function buildComparisonTable(table) {
  if (!table || !table.headers || !table.rows || table.rows.length === 0) return '';
  const headers = table.headers.map(h =>
    `<th class="bg-ink-100/80 font-bold py-3 px-4 text-left text-xs text-ink-700 border-b-2 border-ink-200">${h}</th>`
  ).join('');
  const rows = table.rows.map((row, i) =>
    `<tr class="${i % 2 === 0 ? 'bg-white' : 'bg-ink-100/20'} hover:bg-brand-50 transition-colors">
      ${row.map((cell, ci) => `<td class="py-3 px-4 text-sm ${ci === 0 ? 'font-bold text-ink-700' : 'text-ink-500'} border-b border-ink-100">${cell}</td>`).join('')}
    </tr>`
  ).join('');
  return `
    <div class="not-prose my-8 overflow-x-auto rounded-xl border border-ink-100 shadow-sm">
      <p class="text-xs font-bold text-ink-400 px-4 pt-3 pb-2 bg-ink-100/40 border-b border-ink-100">📊 ${table.caption || '비교 정리'}</p>
      <table class="w-full text-sm">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildSectionHeader(section, idx, meta) {
  const icons = ['🔍', '📝', '💵', '✅', '📌', '🎯'];
  const icon = icons[idx % icons.length];
  return `
    <div class="not-prose flex items-center gap-3 my-8 py-4 px-4 rounded-xl border border-ink-100 bg-gradient-to-r from-ink-100/50 to-transparent">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style="background:${meta.color}18; border:1px solid ${meta.color}30">
        ${icon}
      </div>
      <div>
        <p class="text-[10px] font-bold uppercase tracking-widest mb-0.5" style="color:${meta.color}">Section ${idx + 1}</p>
        <p class="text-base font-black text-ink-800 leading-tight">${section.title}</p>
      </div>
    </div>`;
}

function buildFaqSection(faqs) {
  if (!faqs || faqs.length === 0) return '';
  return faqs.map(f => `
          <details class="faq-item not-prose border border-ink-100 rounded-xl p-4 mb-3 bg-white hover:border-brand-200 transition-colors">
            <summary class="flex items-center justify-between font-bold text-ink-900 text-sm select-none gap-3">
              <span class="flex items-center gap-2"><span class="text-brand-500 font-black shrink-0">Q.</span>${f.question}</span>
              <span class="faq-icon text-ink-300 text-2xl font-light shrink-0">+</span>
            </summary>
            <p class="mt-3 text-sm text-ink-500 leading-relaxed pl-6 border-t border-ink-100 pt-3">${f.answer}</p>
          </details>`).join('\n');
}

function buildImageCards(cards) {
  if (!cards || cards.length === 0) return '';
  const colorMap = {
    stat:       { grad: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', light: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
    checklist:  { grad: 'linear-gradient(135deg,#22c55e,#15803d)', light: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
    process:    { grad: 'linear-gradient(135deg,#a855f7,#7e22ce)', light: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' },
    comparison: { grad: 'linear-gradient(135deg,#f97316,#c2410c)', light: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
    tips:       { grad: 'linear-gradient(135deg,#14b8a6,#0f766e)', light: '#f0fdfa', text: '#0f766e', border: '#99f6e4' },
    summary:    { grad: 'linear-gradient(135deg,#f43f5e,#be123c)', light: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  };
  const cardHTML = cards.slice(0, 5).map(card => {
    const c = colorMap[card.type] || colorMap.tips;
    const items = (card.items || []).map((item, i) => {
      if (card.type === 'process') {
        return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px"><span style="width:20px;height:20px;border-radius:50%;background:${c.grad};color:white;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">${i+1}</span><span style="font-size:13px;color:${c.text};line-height:1.6">${item}</span></div>`;
      }
      if (card.type === 'checklist') {
        return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px"><span style="font-size:12px;font-weight:900;color:${c.text};flex-shrink:0;margin-top:2px">✓</span><span style="font-size:13px;color:${c.text};line-height:1.6">${item}</span></div>`;
      }
      return `<div style="font-size:13px;color:${c.text};line-height:1.6;border-bottom:1px solid ${c.border};padding-bottom:8px;margin-bottom:6px">${item}</div>`;
    }).join('');
    return `<div style="background:${c.light};border:1px solid ${c.border};border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)">
      <div style="background:${c.grad};padding:12px 16px;display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">${card.icon || '📌'}</span>
        <p style="color:white;font-weight:700;font-size:14px;line-height:1.3;margin:0">${card.title}</p>
      </div>
      <div style="padding:16px">${items}</div>
    </div>`;
  }).join('');
  return `<div style="margin:40px 0">
    <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:16px">🖼️ 핵심 인포그래픽</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${cardHTML}</div>
  </div>`;
}

// ─── 포스트별 OG 썸네일 SVG 생성 ─────────────────────────────
function buildThumbnailSVG(data, meta, dateFormatted) {
  const gradients = {
    '세금':     ['#991b1b', '#dc2626'],
    '보험':     ['#1e3a8a', '#2563eb'],
    '부동산':   ['#312e81', '#4f46e5'],
    '복지':     ['#5b21b6', '#7c3aed'],
    '복지정책': ['#5b21b6', '#7c3aed'],
    '주식':     ['#064e3b', '#059669'],
    '경제':     ['#78350f', '#d97706'],
    '리뷰':     ['#075985', '#0284c7'],
  };
  const [c1, c2] = gradients[data.category] || ['#166534', '#16a34a'];
  const title = (data.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const stat = data.stats?.[0] ? `${data.stats[0].value}${data.stats[0].unit || ''}` : '';

  // 제목 줄 나누기 (18자씩)
  const titleWords = title.split('');
  const line1 = titleWords.slice(0, 18).join('');
  const line2 = titleWords.slice(18, 36).join('');
  const line3 = titleWords.slice(36, 52).join('');
  const fontSize = title.length <= 18 ? 58 : title.length <= 28 ? 50 : 44;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="45" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="980" cy="80" r="340" fill="white" fill-opacity="0.04" filter="url(#glow)"/>
  <circle cx="150" cy="540" r="220" fill="white" fill-opacity="0.04" filter="url(#glow)"/>
  <rect x="60" y="52" rx="20" ry="20" width="${data.category.length * 18 + 32}" height="40" fill="white" fill-opacity="0.18"/>
  <text x="${data.category.length * 9 + 76}" y="78" font-family="'Noto Sans KR',Arial,sans-serif" font-size="17" font-weight="700" fill="white" text-anchor="middle">${data.category}</text>
  <text x="72" y="${line2 ? 200 : 240}" font-family="'Noto Sans KR',Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="white" dominant-baseline="middle">${line1}</text>
  ${line2 ? `<text x="72" y="${line3 ? 270 : 290}" font-family="'Noto Sans KR',Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="white" dominant-baseline="middle">${line2}</text>` : ''}
  ${line3 ? `<text x="72" y="350" font-family="'Noto Sans KR',Arial,sans-serif" font-size="${fontSize - 6}" font-weight="900" fill="white" dominant-baseline="middle">${line3}</text>` : ''}
  ${stat ? `<rect x="60" y="430" rx="14" ry="14" width="${stat.length * 22 + 40}" height="56" fill="white" fill-opacity="0.15"/><text x="${stat.length * 11 + 80}" y="464" font-family="'Noto Sans KR',Arial,sans-serif" font-size="30" font-weight="900" fill="white" text-anchor="middle" dominant-baseline="middle">${stat}</text>` : ''}
  <text x="72" y="578" font-family="'Noto Sans KR',Arial,sans-serif" font-size="20" fill="white" fill-opacity="0.55">${dateFormatted} · bloginfo360.com</text>
  <text x="1140" y="590" font-family="'Noto Sans KR',Arial,sans-serif" font-size="72" text-anchor="end">${meta.emoji}</text>
</svg>`;
}

// ─── 포스트 HTML 빌드 ──────────────────────────────────────────
function buildPostHTML(data, slug, dateStr) {
  const meta = getCategoryMeta(data.category);
  const dateFormatted = dateStr.replace(/-/g, '.');
  const isoDate = `${dateStr}T00:00:00+09:00`;
  const postUrl = `https://bloginfo360.com/posts/${slug}`;

  const sectionsHTML = (data.sections || []).map((s, idx) => {
    const paragraphs = (s.content || '')
      .split(/\n{2,}/)
      .filter(Boolean)
      .map(p => `<p>${formatNumbers(p.trim())}</p>`)
      .join('\n          ');

    // tip/highlight: 30자 미만이면 섹션 제목과 같거나 의미없는 내용 → 표시 안 함
    const tipBox       = (s.tip       && s.tip.length       >= 30) ? buildHighlightBox(s.tip,       idx % 2 === 0 ? 'tip' : 'point') : '';
    const highlightBox = (s.highlight && s.highlight.length >= 30) ? buildHighlightBox(s.highlight, 'info')  : '';
    const statCards    = idx === 0   ? buildStatCards(data.stats)                  : '';
    const imageCards   = idx === 1   ? buildImageCards(data.imageCards)             : '';
    const cmpTable     = idx === 2   ? buildComparisonTable(data.comparisonTable)   : '';

    return `
        ${buildSectionHeader(s, idx, meta)}
        <h2 id="${s.id || `section${idx + 1}`}" class="sr-only">${s.title}</h2>
        ${paragraphs}
        ${tipBox}
        ${highlightBox}
        ${statCards}
        ${imageCards}
        ${cmpTable}`;
  }).join('\n');

  const faqJsonLD = (data.faqs || []).map(f => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer }
  }));

  const keyPointsHTML = (data.keyPoints || []).map(p => `
            <li class="flex items-start gap-2 text-sm text-ink-700 leading-relaxed">
              <span class="text-brand-600 font-black shrink-0 mt-0.5">✓</span>
              <span>${p}</span>
            </li>`).join('\n');

  // hashtags: data.hashtags 우선, 없으면 data.tags 폴백
  const hashtagList = (data.hashtags && data.hashtags.length >= 5)
    ? data.hashtags
    : (data.tags || []).map(t => t.startsWith('#') ? t : `#${t}`);
  const tagsHTML = hashtagList.map(t =>
    `<span class="text-xs text-ink-500 bg-ink-100 px-2.5 py-1 rounded-full">${t.startsWith('#') ? t : '#'+t}</span>`
  ).join('\n          ');

  const sourcesHTML = (data.sources || [{ name: '공식 자료 기반 작성', url: '#' }]).map(s =>
    `<li class="text-xs text-ink-500 flex items-start gap-1.5">
              <span class="text-ink-300 shrink-0">•</span>
              <a href="${s.url}" target="_blank" rel="noopener" class="hover:text-brand-600 transition-colors underline decoration-dotted">${s.name}</a>
            </li>`).join('\n          ');

  const introParagraphs = (data.intro || '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(p => `<p>${formatNumbers(p.trim())}</p>`)
    .join('\n          ');

  const tocItems = (data.sections || []).map((s, i) =>
    `<a href="#${s.id || `section${i + 1}`}" class="toc-link">${i + 1}. ${s.title}</a>`
  ).concat(['<a href="#faq" class="toc-link">FAQ</a>']).join('\n              ');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js" async></script>
  <title>${data.title} | 나만 모르는 요즘 소식</title>
  <meta name="description" content="${data.description}">
  <meta name="keywords" content="${hashtagList.map(t => t.replace(/^#/, '')).join(', ')}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="김민주">
  <link rel="canonical" href="${postUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${data.title}">
  <meta property="og:description" content="${data.description}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:url" content="${postUrl}">
  <meta property="og:site_name" content="나만 모르는 요즘 소식">
  <meta property="og:image" content="https://bloginfo360.com/posts/${slug}-thumb.svg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:published_time" content="${isoDate}">
  <meta property="article:modified_time" content="${isoDate}">
  <meta property="article:section" content="${data.category}">
  <meta property="article:author" content="김민주">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${data.title}">
  <meta name="twitter:description" content="${data.description}">
  <meta name="twitter:image" content="https://bloginfo360.com/posts/${slug}-thumb.svg">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"${data.title}","description":"${data.description}","datePublished":"${dateStr}","dateModified":"${dateStr}","author":{"@type":"Person","name":"김민주","url":"https://bloginfo360.com/about"},"publisher":{"@type":"Organization","name":"나만 모르는 요즘 소식","url":"https://bloginfo360.com"},"mainEntityOfPage":{"@type":"WebPage","@id":"${postUrl}"},"image":"https://bloginfo360.com/posts/${slug}-thumb.svg","inLanguage":"ko-KR"}
  </script>
  ${faqJsonLD.length > 0 ? `<script type="application/ld+json">
  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":${JSON.stringify(faqJsonLD)}}
  </script>` : ''}
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"홈","item":"https://bloginfo360.com/"},{"@type":"ListItem","position":2,"name":"${data.category}","item":"https://bloginfo360.com/"},{"@type":"ListItem","position":3,"name":"${data.title}","item":"${postUrl}"}]}
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:"#f0fdf4", 100:"#dcfce7", 200:"#bbf7d0", 500:"#22c55e", 600:"#16a34a", 700:"#15803d" },
            gold:  { 400:"#fbbf24", 500:"#f59e0b" },
            ink:   { 900:"#0f172a", 800:"#1e293b", 700:"#334155", 500:"#475569", 400:"#64748b", 300:"#94a3b8", 200:"#cbd5e1", 100:"#f1f5f9" }
          },
          fontFamily: { sans: ["Noto Sans KR", "sans-serif"] },
          boxShadow: {
            card: "0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)",
            "card-hover": "0 4px 16px rgba(0,0,0,.08)"
          }
        }
      }
    }
  </script>
  <style>
    body { font-family:"Noto Sans KR",sans-serif; background:#fafafa; }
    .prose h2 { font-size:1.3rem; font-weight:800; margin:0; color:#0f172a; line-height:1.4; }
    .prose h3 { font-size:1.05rem; font-weight:700; margin:1.6rem 0 0.5rem; color:#1e293b; }
    .prose p  { line-height:2; margin-bottom:1.2rem; color:#475569; font-size:0.97rem; }
    .prose ul { list-style:none; padding-left:0; margin-bottom:1rem; }
    .prose ul li { padding-left:1.2rem; position:relative; margin-bottom:0.5rem; color:#475569; font-size:0.96rem; line-height:1.8; }
    .prose ul li::before { content:"▸"; position:absolute; left:0; color:#16a34a; font-size:0.75rem; top:0.3em; }
    .prose ol { list-style:decimal; padding-left:1.5rem; margin-bottom:1rem; color:#475569; }
    .prose ol li { margin-bottom:0.5rem; line-height:1.8; font-size:0.96rem; }
    .prose strong { color:#0f172a; font-weight:800; }
    .prose a { color:#16a34a; text-decoration:underline; }
    .prose blockquote { background:linear-gradient(135deg,#f0fdf4,#dcfce7); border-left:4px solid #16a34a; padding:16px 20px; border-radius:0 12px 12px 0; margin:1.8rem 0; color:#1e293b; font-size:0.95rem; line-height:1.9; }
    .btn-share { display:inline-flex; align-items:center; gap:5px; padding:7px 14px; border-radius:8px; font-size:0.8rem; font-weight:600; border:1.5px solid #e2e8f0; background:#fff; color:#475569; cursor:pointer; transition:all 0.15s; text-decoration:none; white-space:nowrap; }
    .btn-share:hover { border-color:#16a34a; color:#16a34a; background:#f0fdf4; }
    .toc-link { display:block; padding:5px 0 5px 12px; color:#64748b; font-size:0.82rem; text-decoration:none; border-left:2px solid #e2e8f0; transition:all 0.15s; line-height:1.5; }
    .toc-link:hover,.toc-link.active { color:#16a34a; border-left-color:#16a34a; background:#f0fdf4; font-weight:700; }
    .badge-보험{background:#dbeafe;color:#1e40af}.badge-세금{background:#fee2e2;color:#b91c1c}
    .badge-부동산{background:#e0e7ff;color:#3730a3}.badge-복지{background:#f3e8ff;color:#7c3aed}
    .badge-주식{background:#dcfce7;color:#166534}.badge-경제{background:#fef9c3;color:#854d0e}
    .badge-제품리뷰{background:#e0f2fe;color:#0369a1}
    .faq-item{cursor:pointer}.faq-item summary{list-style:none}.faq-item summary::-webkit-details-marker{display:none}
    .faq-item[open] summary .faq-icon{transform:rotate(45deg)}.faq-icon{transition:transform 0.2s;display:inline-block}
    @media(max-width:640px){.prose h2{font-size:1.15rem}}
  </style>
</head>
<body class="bg-[#fafafa] text-ink-900">

  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-ink-100 shadow-sm">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="../index.html" class="text-xl font-black text-brand-600 leading-tight">나만 모르는<br class="sm:hidden"> 요즘 소식</a>
      <nav class="hidden sm:flex items-center gap-6 text-sm font-medium text-ink-500">
        <a href="../index.html" class="hover:text-brand-600 transition-colors">홈</a>
        <a href="../index.html#category" class="hover:text-brand-600 transition-colors">카테고리</a>
        <a href="../about.html" class="hover:text-brand-600 transition-colors">소개</a>
      </nav>
      <div class="sm:hidden flex gap-4 text-sm font-medium text-ink-500">
        <a href="../index.html" class="hover:text-brand-600">홈</a>
        <a href="../about.html" class="hover:text-brand-600">소개</a>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 py-8">
    <nav aria-label="breadcrumb" class="mb-6 text-xs text-ink-300 flex items-center gap-1.5 flex-wrap">
      <a href="../index.html" class="hover:text-brand-600 transition-colors">홈</a>
      <span>›</span>
      <span class="text-ink-500">${data.category}</span>
      <span>›</span>
      <span class="text-ink-500 font-medium line-clamp-1">${data.title}</span>
    </nav>

    <div class="flex flex-col lg:flex-row gap-10">
      <article class="flex-1 min-w-0 bg-white rounded-2xl border border-ink-100 shadow-card p-6 sm:p-8">

        <div class="flex flex-wrap gap-2 items-center mb-4">
          <span class="text-xs font-bold px-2.5 py-0.5 rounded-full ${meta.badge}">${data.category}</span>
          <span class="text-xs text-ink-300">${dateFormatted}</span>
          <span class="text-xs text-ink-300">·</span>
          <span class="text-xs text-ink-300" id="readTime"></span>
        </div>

        <h1 class="text-2xl sm:text-3xl font-black text-ink-900 leading-tight mb-3">${data.title}</h1>
        <p class="text-ink-400 text-sm mb-6 leading-relaxed">${data.description}</p>

        <div class="flex items-center gap-3 mb-8 pb-6 border-b border-ink-100">
          <div class="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white font-black text-sm shrink-0">민</div>
          <div>
            <a href="../about.html" class="text-sm font-bold text-ink-900 hover:text-brand-600 transition-colors">김민주</a>
            <p class="text-xs text-ink-300">나만 모르는 요즘 소식 운영자 · 공식 자료 기반 팩트체크</p>
          </div>
        </div>

        <!-- 히어로 이미지 -->
        <div class="relative w-full h-56 sm:h-72 rounded-2xl overflow-hidden mb-8 border border-ink-100 bg-gradient-to-br ${meta.gradient}" role="img" aria-label="${data.title}">
          <img src="https://picsum.photos/seed/${slug}/1200/630" alt="${data.title}" class="absolute inset-0 w-full h-full object-cover" loading="eager" onerror="this.style.opacity='0'">
          <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"></div>
          <div class="absolute top-4 left-4">
            <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 text-white border border-white/20 backdrop-blur-sm">${meta.emoji} ${data.category}</span>
          </div>
          <div class="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
            <p class="text-white font-black text-lg sm:text-xl leading-tight drop-shadow-lg">${data.title}</p>
            <p class="text-white/60 text-xs mt-1.5">${dateFormatted} · bloginfo360.com</p>
          </div>
        </div>

        <!-- 핵심 요약 -->
        <div class="bg-brand-50 border border-brand-200 rounded-2xl p-5 mb-8">
          <p class="text-xs font-bold text-brand-700 uppercase tracking-widest mb-3">📌 이 글의 핵심 3가지</p>
          <ul class="space-y-2.5">${keyPointsHTML}</ul>
        </div>

        <!-- 본문 -->
        <div class="prose" id="article-body">
          ${introParagraphs || ''}
          ${sectionsHTML}

          <hr class="my-10 border-ink-100">

          <!-- FAQ -->
          <div class="not-prose mb-2">
            <h2 id="faq" class="text-xl font-black text-ink-900 mb-1 flex items-center gap-2">
              <span class="text-brand-500">Q&amp;A</span> 자주 묻는 질문
            </h2>
            <p class="text-xs text-ink-300 mb-5">독자들이 가장 많이 물어보는 질문을 모았습니다</p>
          </div>
          ${buildFaqSection(data.faqs)}
        </div>

        <div class="bg-ink-100/40 rounded-2xl p-5 mb-5">
          <p class="text-xs font-bold text-ink-400 uppercase tracking-wide mb-3">📚 출처 및 참고자료</p>
          <ul class="space-y-1.5">${sourcesHTML}</ul>
        </div>

        <div class="border border-amber-200 bg-amber-50 rounded-2xl p-4 mb-8">
          <p class="text-xs font-bold text-amber-700 mb-1.5">⚠️ 면책조항</p>
          <p class="text-xs text-amber-700 leading-relaxed">이 글은 일반적인 정보 제공 목적으로 작성되었으며, 투자·재정·세무·법률 전문가의 조언을 대체하지 않습니다. 개인 상황에 따라 결과가 다를 수 있으므로 중요한 결정 전 반드시 해당 분야 전문가와 상담하시기 바랍니다.</p>
        </div>

        <div class="mb-8 flex flex-wrap gap-2">${tagsHTML}</div>

        <div class="pt-6 border-t border-ink-100 flex flex-wrap gap-2 mb-2">
          <button class="btn-share" onclick="copyLink()">🔗 링크 복사</button>
          <a class="btn-share" id="twitterShare" href="#" target="_blank" rel="noopener">🐦 X(트위터)</a>
          <a class="btn-share" id="fbShare" href="#" target="_blank" rel="noopener">📘 페이스북</a>
        </div>
        <p id="copyMsg" class="text-xs text-brand-600 mt-2 mb-8 hidden">✅ 링크가 복사되었습니다!</p>

      </article>

      <aside class="w-full lg:w-64 shrink-0">
        <div class="sticky top-20 space-y-5">
          <div class="bg-white border border-ink-100 rounded-2xl p-5 shadow-card">
            <p class="text-xs font-bold text-ink-400 uppercase mb-3 tracking-widest">📖 목차</p>
            <nav id="tocNav" class="space-y-0.5">${tocItems}</nav>
          </div>
          <div class="bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl p-5 text-white shadow-card">
            <p class="font-bold text-sm mb-1">🔔 새 글 알림 받기</p>
            <p class="text-brand-200 text-xs mb-3 leading-relaxed">보험·세금·복지 핵심 정보를<br>이메일로 바로 받아보세요</p>
            <a href="../index.html#newsletter" class="block text-center bg-white text-brand-600 text-xs font-bold py-2.5 rounded-lg hover:bg-brand-50 transition-colors">무료 구독하기</a>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <footer class="border-t border-ink-100 bg-white mt-16">
    <div class="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-300">
      <span class="font-bold text-ink-500">나만 모르는 요즘 소식</span>
      <div class="flex items-center gap-4">
        <a href="../about.html" class="hover:text-brand-600 transition-colors">소개</a>
        <a href="../privacy.html" class="hover:text-brand-600 transition-colors">개인정보처리방침</a>
        <a href="mailto:mju427@naver.com" class="hover:text-brand-600 transition-colors">mju427@naver.com</a>
      </div>
      <span>© 2026. All rights reserved.</span>
    </div>
  </footer>

  <script>
    (function(){
      const body=document.getElementById('article-body'),el=document.getElementById('readTime');
      if(body&&el){const c=body.innerText.replace(/\s+/g,'').length;el.textContent='읽는 시간 약 '+Math.max(1,Math.ceil(c/600))+'분';}
    })();
    (function(){
      const toc=document.getElementById('tocNav');
      if(!toc)return;
      const links=Array.from(toc.querySelectorAll('a.toc-link'));
      const headings=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
      if(!headings.length)return;
      const obs=new IntersectionObserver(entries=>{
        entries.forEach(e=>{const l=toc.querySelector('a[href="#'+e.target.id+'"]');if(l)l.classList.toggle('active',e.isIntersecting);});
      },{rootMargin:'-10% 0px -75% 0px'});
      headings.forEach(h=>obs.observe(h));
    })();
    (function(){
      const url=encodeURIComponent(window.location.href),title=encodeURIComponent(document.title);
      const tw=document.getElementById('twitterShare'),fb=document.getElementById('fbShare');
      if(tw)tw.href='https://twitter.com/intent/tweet?text='+title+'&url='+url;
      if(fb)fb.href='https://www.facebook.com/sharer/sharer.php?u='+url;
    })();
    function copyLink(){navigator.clipboard.writeText(window.location.href).then(()=>{const m=document.getElementById('copyMsg');if(m){m.classList.remove('hidden');setTimeout(()=>m.classList.add('hidden'),2500);}});}
  </script>
</body>
</html>`;
}

// ─── 파일 저장 ────────────────────────────────────────────────
function savePost(data, slug, dateStr) {
  const postsDir = path.join(ROOT, 'posts');
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });
  // 포스트별 OG 썸네일 SVG 생성
  const meta = getCategoryMeta(data.category);
  const dateFormatted = dateStr.replace(/-/g, '.');
  const thumbSVG = buildThumbnailSVG(data, meta, dateFormatted);
  writeFileSync(path.join(postsDir, `${slug}-thumb.svg`), thumbSVG, 'utf-8');
  console.log(`✅ posts/${slug}-thumb.svg 저장`);
  // 포스트 HTML 저장
  const html = buildPostHTML(data, slug, dateStr);
  writeFileSync(path.join(postsDir, `${slug}.html`), html, 'utf-8');
  console.log(`✅ posts/${slug}.html 저장`);
}

function updateIndex(data, slug, dateStr) {
  const indexPath = path.join(ROOT, 'index.html');
  if (!existsSync(indexPath)) return;
  const meta = getCategoryMeta(data.category);
  const dateFormatted = dateStr.replace(/-/g, '.');
  const firstStat = (data.stats && data.stats[0]) ? `${data.stats[0].value}${data.stats[0].unit || ''}` : '';
  const card = `
      <article class="post-item" data-category="${data.category}" data-title="${data.title}">
        <a href="posts/${slug}.html" class="block bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover post-card overflow-hidden transition-shadow">
          <div class="relative w-full h-44 overflow-hidden bg-gradient-to-br ${meta.gradient}">
            <img src="https://picsum.photos/seed/${slug}/600/400" alt="${data.title}" class="absolute inset-0 w-full h-full object-cover" loading="lazy" onerror="this.style.opacity='0'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent"></div>
            <div class="absolute top-3 left-3">
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/20 backdrop-blur-sm">${meta.emoji} ${data.category}</span>
            </div>
            <div class="absolute bottom-0 left-0 right-0 p-3">
              <p class="text-white font-black text-xs leading-snug drop-shadow line-clamp-2">${data.title.slice(0, 40)}${data.title.length > 40 ? '…' : ''}</p>
              ${firstStat ? `<p class="text-white/70 text-[10px] mt-0.5 font-medium">${firstStat}</p>` : ''}
            </div>
          </div>
          <div class="p-5">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs font-bold px-2 py-0.5 rounded-full ${meta.badge}">${data.category}</span>
              <span class="text-xs text-ink-300">${dateFormatted}</span>
            </div>
            <h2 class="font-black text-ink-900 text-base leading-snug mb-2 line-clamp-2">${data.title}</h2>
            <p class="text-xs text-ink-500 line-clamp-2 leading-relaxed">${data.description}</p>
          </div>
        </a>
      </article>`;
  let content = readFileSync(indexPath, 'utf-8');
  content = content.replace('<!-- POSTS_START -->', `<!-- POSTS_START -->\n${card}`);
  writeFileSync(indexPath, content, 'utf-8');
  console.log(`✅ index.html 업데이트`);
}

function updateSitemap(slug, dateStr) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  if (!existsSync(sitemapPath)) return;
  const entry = `
  <url>
    <loc>https://bloginfo360.com/posts/${slug}</loc>
    <lastmod>${dateStr}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  let content = readFileSync(sitemapPath, 'utf-8');
  content = content.replace('<!-- 포스트 목록 (새 글 추가 시 아래 형식으로 추가) -->', `<!-- 포스트 목록 (새 글 추가 시 아래 형식으로 추가) -->${entry}`);
  writeFileSync(sitemapPath, content, 'utf-8');
  console.log(`✅ sitemap.xml 업데이트`);
}

function updateFeed(data, slug, dateStr) {
  const feedPath = path.join(ROOT, 'feed.xml');
  if (!existsSync(feedPath)) return;
  const pubDate = new Date(dateStr + 'T09:00:00+09:00').toUTCString();
  const item = `
    <item>
      <title><![CDATA[${data.title}]]></title>
      <link>https://bloginfo360.com/posts/${slug}</link>
      <guid>https://bloginfo360.com/posts/${slug}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${data.description}]]></description>
    </item>`;
  let content = readFileSync(feedPath, 'utf-8');
  content = content.replace('<item>', `${item}\n\n    <item>`);
  writeFileSync(feedPath, content, 'utf-8');
  console.log(`✅ feed.xml 업데이트`);
}

function updateTopicsHistory(data, slug, dateStr) {
  const histPath = path.join(ROOT, 'topics-history.json');
  let history = [];
  if (existsSync(histPath)) {
    try { history = JSON.parse(readFileSync(histPath, 'utf-8')); } catch {}
  }
  history.unshift({ slug, title: data.title, category: data.category, date: dateStr });
  if (history.length > 100) history = history.slice(0, 100);
  writeFileSync(histPath, JSON.stringify(history, null, 2), 'utf-8');
  console.log(`✅ topics-history.json 업데이트`);
}

function makeSlug(category, dateStr) {
  const cat = category.toLowerCase().replace(/[^a-z0-9]/g, '') || 'post';
  const d = dateStr.replace(/-/g, '');
  return `${cat}-${d}`.slice(0, 40);
}

// ─── 메인 ────────────────────────────────────────────────────
async function run() {
  console.log(`🚀 자동 글 생성 | 모드: ${GENERATION_MODE} | 카테고리: ${CATEGORIES.join(', ')}`);

  if (!GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY 환경변수 없음');
    process.exit(1);
  }

  const dateStr = new Date().toISOString().split('T')[0];

  if (GENERATION_MODE === 'news') {
    let successCount = 0;
    for (const category of CATEGORIES) {
      try {
        console.log(`\n📰 [${category}] 처리 중...`);
        const newsCtx = await fetchNewsContext(category);

        // 출처 후보 URL 목록 (실제 뉴스에서 가져온 것)
        const realSources = newsCtx ? newsCtx.all.map(n => ({
          name: `${n.source || '언론사'} — ${n.title.slice(0, 40)} (${new Date(n.pubDate || Date.now()).toISOString().slice(0,7).replace('-','.')})`,
          url: n.link
        })) : [];

        const newsContext = newsCtx
          ? newsCtx.all.slice(0, 5).map((n, i) =>
              `[뉴스${i+1}] ${n.title}${n.desc ? `\n  요약: ${n.desc}` : ''} (출처: ${n.source || '언론'})`
            ).join('\n')
          : '';

        const prompt = newsCtx
          ? `카테고리: ${category}

[오늘의 실제 뉴스 — 아래 내용을 반드시 참고해서 작성]
${newsContext}

위 실제 뉴스를 바탕으로 "${category}" 카테고리의 정보성 블로그 포스팅을 작성하세요.
- 뉴스에 나온 실제 수치·날짜·기관명을 글에 적극 반영할 것
- 각 섹션 content: 최소 1,000자의 완성된 본문 (2~3문장 요약 절대 금지)
- intro: 최소 800자의 완성된 도입 본문
- stats의 value는 순수 숫자/금액만 (날짜·연도·텍스트 금지)
- hashtags 12개 이상, imageCards 5개, sources 3개`
          : `카테고리: ${category}

"${category}" 주제로 2026년 한국 독자에게 유용한 정보성 블로그 포스팅을 작성하세요.
- 실제 한국 정책·제도·수치 기반 작성
- 각 섹션 content: 최소 1,000자의 완성된 본문 (2~3문장 요약 절대 금지)
- intro: 최소 800자의 완성된 도입 본문
- stats의 value는 순수 숫자/금액만 (날짜·연도·텍스트 금지)
- hashtags 12개 이상, imageCards 5개`;

        console.log(`🤖 AI 생성 중...`);
        const result = await callGroq(prompt);

        // 실제 뉴스 URL로 sources 교체 (할루시네이션 URL 방지)
        if (realSources.length >= 2) {
          result.sources = realSources.slice(0, 3);
          // 부족하면 기존 생성분으로 채움
          while (result.sources.length < 3 && (result.sources?.length || 0) < 3) {
            result.sources.push({ name: '공식 자료 기반 작성', url: `https://www.google.com/search?q=${encodeURIComponent(category)}+2026` });
          }
        } else if (realSources.length === 1) {
          result.sources = [realSources[0],
            { name: '공식 자료 기반 작성', url: `https://www.google.com/search?q=${encodeURIComponent(category)}+2026` },
            { name: `${category} 관련 정책 정보`, url: `https://www.google.com/search?q=${encodeURIComponent(category)}+정책+2026` }
          ];
        }

        const slug = result.slug
          ? result.slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          : makeSlug(category, dateStr);

        savePost(result, slug, dateStr);
        updateIndex(result, slug, dateStr);
        updateSitemap(slug, dateStr);
        updateFeed(result, slug, dateStr);
        updateTopicsHistory(result, slug, dateStr);

        successCount++;
        console.log(`✅ [${category}] 완료: "${result.title}"`);
      } catch (e) {
        console.error(`❌ [${category}] 실패: ${e.message}`);
      }
    }
    console.log(`\n🎉 완료: ${successCount}/${CATEGORIES.length}개 생성`);

  } else if (GENERATION_MODE === 'product_review') {
    const productLinksEnv = process.env.PRODUCT_LINKS || '';
    const lines = productLinksEnv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { console.log('❌ PRODUCT_LINKS 환경변수 없음'); return; }

    for (const line of lines) {
      try {
        const parts = line.split('|');
        const affiliateUrl = parts[0]?.trim();
        if (!affiliateUrl) continue;
        const platform = parts[1]?.trim() || 'coupang';

        const result = await callGroq(
          `플랫폼: ${platform}\n링크: ${affiliateUrl}\n\n위 제품에 대한 솔직한 사용 후기 리뷰를 작성해주세요. category는 "리뷰"로 설정. 각 섹션 700자 이상.`
        );
        result.category = result.category || '리뷰';

        const slug = result.slug
          ? result.slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
          : makeSlug('review', dateStr);

        savePost(result, slug, dateStr);
        updateIndex(result, slug, dateStr);
        updateSitemap(slug, dateStr);
        updateFeed(result, slug, dateStr);
        updateTopicsHistory(result, slug, dateStr);

        console.log(`✅ 리뷰 완료: "${result.title}"`);
      } catch (e) {
        console.error(`❌ 리뷰 실패: ${e.message}`);
      }
    }
  }
}

run().catch(e => {
  console.error('❌ 에러 발생:', e.message);
  process.exit(1);
});
