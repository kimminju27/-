/**
 * 자동 글 생성 스크립트
 * - news 모드: Google News RSS → Gemini API → 뉴스 기사 HTML 생성
 * - product_review 모드: 제품 URL → Gemini API → 리뷰 HTML 생성
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
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

// JSON 문자열 내 제어문자 이스케이프 (AI가 줄바꿈을 그대로 넣을 때 대응)
function repairJson(str) {
  let inString = false;
  let escaped = false;
  let result = '';
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

// 외국어 문자 제거: 중국 한자 + 일본 히라가나/가타카나 + 베트남어 등 라틴 확장 (한국어 한글은 유지)
function removeForeignChars(text) {
  if (typeof text !== 'string') return text;
  return text
    // 일본어 히라가나 (あいうえお...)
    .replace(/[\u3041-\u309F]/g, '')
    // 일본어 가타카나 (アイウエオ...)
    .replace(/[\u30A0-\u30FF]/g, '')
    // 중국어 한자 (CJK Unified Ideographs)
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, '')
    // 키릴 문자 (러시아어 등) 포함 단어 통째로 제거
    .replace(/\S*[\u0400-\u04FF]+\S*/g, '')
    // 아랍어, 태국어, 히브리어 등 기타 비라틴 문자 제거
    .replace(/[\u0600-\u06FF\u0E00-\u0E7F\u0590-\u05FF]+/g, '')
    // 베트남어·프랑스어 등 라틴 확장 문자(ắềụổế 등)가 포함된 단어 통째로 제거
    .replace(/\S*[\u00C0-\u024F\u1E00-\u1EFF]\S*/g, '')
    // 영어 단어가 한글 문장 중간에 삽입된 경우 제거 (앞뒤가 한글/공백인 영단어)
    .replace(/(?<=[가-힣\s])[A-Za-z]{2,}(?=[가-힣\s])/g, '')
    // 영어 단어가 한글 조사/어미와 직접 붙은 경우 제거 (예: Narrow한, recently는)
    .replace(/[A-Za-z]{2,}(?=[은는이가을를에서도의과와한])/g, '')
    // 문장 맨 앞에 오는 영어 단어 제거 (예: recently 벤딕트)
    .replace(/^[A-Za-z]{2,}\s+/gm, '');
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
// 1. 주제 풀 (Topic Pool) — 구체적 주제 60개
//    매 실행마다 안 쓴 주제를 골라 완전히 다른 글 생성
// ─────────────────────────────────────────
const TOPIC_POOL = [
  // 경제
  { id: 'eco-001', category: '경제', label: '기준금리 동결 대출이자 영향', query: '한국은행 기준금리 동결 대출이자 가계부채' },
  { id: 'eco-002', category: '경제', label: '원달러 환율 급등 대응법', query: '원달러 환율 급등 외환시장 수입물가 대응' },
  { id: 'eco-003', category: '경제', label: '소비자물가 상승 장바구니', query: '소비자물가지수 식품 외식비 장바구니 생활비' },
  { id: 'eco-004', category: '경제', label: '무역수지 반도체 수출', query: '무역수지 반도체 수출 흑자 대미무역' },
  { id: 'eco-005', category: '경제', label: '청년 실업률 취업난', query: '청년 실업률 취업난 구직 일자리 고용' },
  { id: 'eco-006', category: '경제', label: '미국 관세 한국 경제 영향', query: '미국 관세 한국 수출 경제 영향 대응' },
  { id: 'eco-007', category: '경제', label: '최저임금 인상 자영업 영향', query: '최저임금 인상 자영업자 인건비 영향' },
  { id: 'eco-008', category: '경제', label: '국내총생산 GDP 성장률', query: '한국 GDP 경제성장률 전망 IMF 전망' },
  // 부동산
  { id: 'real-001', category: '부동산', label: '서울 아파트 집값 전망', query: '서울 아파트 매매가 집값 전망 거래량' },
  { id: 'real-002', category: '부동산', label: '전세사기 피해 구제 방법', query: '전세사기 피해자 구제 보증금 반환 방법' },
  { id: 'real-003', category: '부동산', label: '청약 당첨 전략 가점 계산', query: '청약 분양 당첨 가점 청약통장 전략' },
  { id: 'real-004', category: '부동산', label: '재개발 재건축 투자 수익', query: '재개발 재건축 조합원 분담금 수익 투자' },
  { id: 'real-005', category: '부동산', label: '1인가구 원룸 오피스텔 월세', query: '원룸 오피스텔 1인가구 월세 임대차' },
  { id: 'real-006', category: '부동산', label: '3기 신도시 GTX 분양', query: '3기 신도시 GTX 분양 청약 입주 일정' },
  { id: 'real-007', category: '부동산', label: '빌라 연립 매수 리스크', query: '빌라 연립주택 매수 전세 리스크 주의사항' },
  { id: 'real-008', category: '부동산', label: '신혼부부 주택 구입 지원', query: '신혼부부 주택구입 대출 지원 혜택 정책' },
  { id: 'real-009', category: '부동산', label: '수도권 전세가율 위험 지역', query: '전세가율 수도권 위험 지역 깡통전세 주의' },
  { id: 'real-010', category: '부동산', label: '임대차 3법 계약갱신 청구권', query: '임대차 계약갱신청구권 전월세 상한제 임차인' },
  // 주식
  { id: 'stock-001', category: '주식', label: '코스피 외국인 매수 전망', query: '코스피 외국인 매수 주가 전망 증시' },
  { id: 'stock-002', category: '주식', label: '미국 나스닥 S&P500 투자법', query: '미국주식 나스닥 S&P500 투자 방법 초보' },
  { id: 'stock-003', category: '주식', label: '배당주 월배당 투자 전략', query: '배당주 월배당 배당금 배당투자 장기투자' },
  { id: 'stock-004', category: '주식', label: '삼성전자 SK하이닉스 반도체주', query: '삼성전자 SK하이닉스 반도체 주가 실적' },
  { id: 'stock-005', category: '주식', label: 'ETF 종류별 수익률 비교', query: 'ETF 종류 수익률 비교 추천 인덱스' },
  { id: 'stock-006', category: '주식', label: '공매도 재개 개인투자자 대응', query: '공매도 재개 개인투자자 대응 주식시장' },
  { id: 'stock-007', category: '주식', label: '2차전지 배터리주 전망', query: '2차전지 배터리 LG에너지솔루션 주가 전망' },
  { id: 'stock-008', category: '주식', label: 'AI 인공지능 관련주', query: 'AI 인공지능 관련주 수혜주 투자 테마' },
  { id: 'stock-009', category: '주식', label: '주식 세금 양도소득세 절세', query: '주식 양도소득세 절세 금융투자소득세' },
  { id: 'stock-010', category: '주식', label: '연금저축 IRP 세액공제', query: '연금저축 IRP 세액공제 노후 절세 투자' },
  // 복지정책
  { id: 'wel-001', category: '복지정책', label: '청년도약계좌 가입 조건 혜택', query: '청년도약계좌 가입조건 신청방법 혜택 금리' },
  { id: 'wel-002', category: '복지정책', label: '기초연금 수급 자격 금액', query: '기초연금 노인 수급자격 금액 신청방법' },
  { id: 'wel-003', category: '복지정책', label: '출산 지원금 바우처 총정리', query: '출산 지원금 임신 바우처 산모 혜택 총정리' },
  { id: 'wel-004', category: '복지정책', label: '청년월세 한시 특별지원', query: '청년 월세 지원 한시 특별지원 신청 조건' },
  { id: 'wel-005', category: '복지정책', label: '에너지 바우처 난방비 지원', query: '에너지 바우처 난방비 지원 취약계층 신청' },
  { id: 'wel-006', category: '복지정책', label: '국민연금 개혁 수령 나이', query: '국민연금 개혁 보험료율 수급연령 노후' },
  { id: 'wel-007', category: '복지정책', label: '건강보험료 환급 신청법', query: '건강보험료 환급 본인부담금 상한액 신청' },
  { id: 'wel-008', category: '복지정책', label: '장애인 활동지원 급여 확대', query: '장애인 활동지원 급여 서비스 확대 신청' },
  { id: 'wel-009', category: '복지정책', label: '아동수당 지원 대상 확대', query: '아동수당 지원 대상 금액 신청 방법' },
  { id: 'wel-010', category: '복지정책', label: '실업급여 조건 수급 기간', query: '실업급여 수급조건 신청 기간 금액 방법' },
  // 세금
  { id: 'tax-001', category: '세금', label: '연말정산 환급 최대로 받는 법', query: '연말정산 환급 공제 13월의 월급 방법' },
  { id: 'tax-002', category: '세금', label: '종합소득세 프리랜서 신고', query: '종합소득세 프리랜서 사업소득 신고 절세' },
  { id: 'tax-003', category: '세금', label: '증여세 가족 간 절세 한도', query: '증여세 상속세 가족간 절세 한도 방법' },
  { id: 'tax-004', category: '세금', label: '부동산 양도소득세 절세', query: '부동산 양도소득세 절세 1주택 비과세' },
  { id: 'tax-005', category: '세금', label: '근로소득세 과세표준 변경', query: '근로소득세 과세표준 세율 변경 2026' },
  { id: 'tax-006', category: '세금', label: 'ISA 계좌 비과세 한도 활용', query: 'ISA 계좌 비과세 한도 절세 투자 활용법' },
  { id: 'tax-007', category: '세금', label: '상속세 개편안 핵심 정리', query: '상속세 개편 공제 한도 세율 2026 변경' },
  { id: 'tax-008', category: '세금', label: '부가세 간이과세자 기준', query: '부가가치세 간이과세자 기준 신고 방법' },
  { id: 'tax-009', category: '세금', label: '해외주식 양도소득세 신고법', query: '해외주식 양도소득세 신고 절세 방법 2026' },
  { id: 'tax-010', category: '세금', label: '1주택 비과세 요건 총정리', query: '1세대 1주택 비과세 요건 거주기간 양도세' },
  // 금융
  { id: 'fin-001', category: '금융', label: '고금리 예금 적금 특판 비교', query: '예금 적금 특판 고금리 은행 금리비교' },
  { id: 'fin-002', category: '금융', label: 'ISA 계좌 절세 투자 활용법', query: 'ISA 계좌 절세 비과세 투자 활용 방법' },
  { id: 'fin-003', category: '금융', label: '주택담보대출 금리 대환대출', query: '주택담보대출 금리 대환대출 은행 비교' },
  { id: 'fin-004', category: '금융', label: '신용점수 올리는 방법', query: '신용점수 신용등급 올리기 관리 방법' },
  { id: 'fin-005', category: '금융', label: '청년 우대형 청약통장', query: '청년 우대형 청약통장 금리 가입 조건' },
  { id: 'fin-006', category: '금융', label: '소액 투자 재테크 시작법', query: '소액 투자 재테크 시작 초보 방법 추천' },
  // 보험 — 고CPC 카테고리
  { id: 'ins-001', category: '보험', label: '실손보험 개편 핵심 정리', query: '실손보험 개편 보험료 청구 방법 2026' },
  { id: 'ins-002', category: '보험', label: '자동차보험 비교 절약법', query: '자동차보험 비교 보험료 절감 방법 추천' },
  { id: 'ins-003', category: '보험', label: '암보험 가입 주의사항', query: '암보험 가입 주의사항 보장내용 비교 추천' },
  { id: 'ins-004', category: '보험', label: '생명보험 종신보험 차이', query: '생명보험 종신보험 정기보험 비교 추천' },
  { id: 'ins-005', category: '보험', label: '치아보험 임플란트 보장', query: '치아보험 임플란트 보장 가성비 비교 추천' },
  { id: 'ins-006', category: '보험', label: '건강보험 실비 청구 방법', query: '건강보험 실비 보험금 청구 방법 절차' },
  { id: 'ins-007', category: '보험', label: '태아보험 어린이보험 차이', query: '태아보험 어린이보험 가입 시기 비교 추천' },
  { id: 'ins-008', category: '보험', label: '환급형 순수보장형 보험 비교', query: '환급형 순수보장형 보험 차이 비교 추천' },
  { id: 'ins-009', category: '보험', label: '운전자보험 필요성 보장', query: '운전자보험 필요성 보장내용 추천 비교' },
  { id: 'ins-010', category: '보험', label: '노후 간병보험 준비', query: '간병보험 노후 의료비 준비 추천 비교' },
];

// 사용한 주제 추적 (topics-history.json)
const TOPICS_HISTORY_PATH = path.join(ROOT, 'topics-history.json');

function getUsedTopicIds() {
  if (!existsSync(TOPICS_HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(TOPICS_HISTORY_PATH, 'utf-8')); } catch { return []; }
}

function markTopicUsed(id) {
  let used = getUsedTopicIds();
  if (!used.includes(id)) used.push(id);
  // 80% 이상 소진 시 전체 리셋
  if (used.length >= Math.floor(TOPIC_POOL.length * 0.8)) {
    console.log('📋 주제 풀 80% 소진 → 히스토리 리셋');
    used = [];
  }
  writeFileSync(TOPICS_HISTORY_PATH, JSON.stringify(used, null, 2), 'utf-8');
}

// 카테고리 별칭 맵: split('_')[0] 결과 → TOPIC_POOL category명
const CATEGORY_ALIAS = { '복지': '복지정책' };

// 카테고리에서 아직 안 쓴 주제 랜덤 선택
function pickUnusedTopic(category) {
  const used = getUsedTopicIds();
  // 카테고리 매칭: '부동산', '부동산_전세' 둘 다 → category '부동산' 매칭
  const base = category.split('_')[0];
  const mappedBase = CATEGORY_ALIAS[base] || base;
  const pool = TOPIC_POOL.filter(t => t.category === mappedBase || t.category === base || t.category === category);
  const available = pool.filter(t => !used.includes(t.id));
  const candidates = available.length > 0 ? available : pool; // 소진 시 전체에서 선택
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 구글 뉴스 상위 트렌딩 뉴스 수집 (실시간)
async function fetchTrendingNews(category) {
  // 1) 카테고리 키워드로 뉴스 검색
  const base = category.split('_')[0];
  const queries = {
    '경제': '한국 경제',
    '부동산': '부동산',
    '주식': '주식 증시',
    '복지': '복지 정책 지원',
    '복지정책': '복지 정책 지원',
    '세금': '세금 절세',
    '금융': '금융 재테크',
    '보험': '보험 실손 가입 비교',
  };
  const q = encodeURIComponent(queries[base] || base);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
    const xml = await res.text();
    const items = [];
    for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10)) {
      const t = m[1];
      const title = (t.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || t.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
      const desc = (t.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || t.match(/<description>(.*?)<\/description>/))?.[1]
        ?.replace(/<[^>]*>/g, '').trim().substring(0, 200) || '';
      if (title.length > 5) items.push({ title, desc });
    }
    return items;
  } catch { return []; }
}

async function fetchNewsRSS(query) {
  const q = encodeURIComponent(query);
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
    console.warn(`RSS 가져오기 실패 (${query}):`, e.message);
    return [];
  }
}

// ─────────────────────────────────────────
// 2. 뉴스 기사 생성
// ─────────────────────────────────────────
async function fetchEntNewsMulti(queries) {
  // 여러 검색어로 RSS를 병렬 수집해 교차 검증용 데이터 확보
  const results = await Promise.allSettled(
    queries.map(q => fetchNewsRSS(q))
  );
  const allItems = [];
  results.forEach(r => {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  });
  // 중복 제거
  return allItems.filter((v, i, a) => a.findIndex(x => x.title === v.title) === i);
}

async function generateEntertainmentArticle(category) {
  const today = getKSTDate();
  const base = '연예계';

  // 오늘 이미 연예계 글이 발행된 경우 스킵 (동시 실행 중복 방지)
  const existingToday = getTodayCategoryPost(base, today);
  if (existingToday) {
    console.log(`⏭️ [연예계] 오늘(${today}) 이미 발행됨: ${existingToday} — 스킵`);
    return null;
  }

  console.log(`\n📡 연예계 뉴스 다중 수집 중...`);

  // 1단계: 방영 중 드라마/예능 중심으로 RSS 수집
  const multiItems = await fetchEntNewsMulti([
    '방영중 드라마 2026 화제',
    '예능 프로그램 최신화 2026',
    '드라마 시청률 최신 줄거리',
    '넷플릭스 티빙 드라마 신작',
  ]);

  const trendingContext = multiItems.length > 0
    ? multiItems.slice(0, 16).map((n, i) => `${i + 1}. ${n.title}\n   ${n.desc}`).join('\n\n')
    : '';

  const usedTitles = getExistingPostTitles();
  const avoidList = usedTitles.length > 0
    ? `⛔ 아래 주제들은 이미 발행했으므로 절대 선택하지 마세요:\n${usedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  // 2단계: 수집된 뉴스 중 여러 소스에서 확인된 이슈 선정
  const topicPickPrompt = `당신은 한국 연예 뉴스 팩트체커 겸 에디터입니다.

오늘 날짜: ${today}
${avoidList}
아래는 구글 뉴스 RSS에서 실시간 수집한 연예 뉴스 목록입니다:
${trendingContext || '연예계 최신 이슈'}

선정 기준 (엄격하게 적용):
1. 위 뉴스 목록에 실제로 등장하는 이슈만 선택 (목록에 없는 내용 지어내기 금지)
2. 현재 방영 중인 드라마 또는 예능 프로그램 관련 이슈를 최우선으로 선정
3. 여러 뉴스 제목에서 반복적으로 등장하는 작품명/장면을 우선 선택 (다중 소스 확인)
4. 오늘 날짜 기준 가장 최신 에피소드나 화제 장면 1개 선정
5. 루머/찌라시가 아닌 공식 방영 내용 또는 미디어 보도된 내용만
6. 드라마/예능 관련 내용이 없을 경우에만 다른 연예 이슈 선정

JSON으로만 응답:
{"topic": "구체적 이슈 (한국어, 30자 이내)", "query": "추가 검색 키워드 (한국어, 10-20자)", "reason": "선정 이유 — 몇 개 소스에서 확인됐는지 포함", "confirmed": true}`;

  let chosenTopic = { topic: '', query: '', reason: '', confirmed: false };
  try {
    const pickText = await callGroq(topicPickPrompt, { maxTokens: 400, jsonMode: true });
    const parsed = JSON.parse(pickText.match(/\{[\s\S]*\}/)?.[0] || pickText);
    chosenTopic = {
      topic: parsed.topic || '',
      query: parsed.query || '연예계',
      reason: parsed.reason || '',
      confirmed: parsed.confirmed || false,
    };
  } catch { chosenTopic = { topic: '', query: '연예계 이슈', reason: '', confirmed: false }; }

  if (!chosenTopic.topic) {
    const fallback = pickUnusedTopic(category);
    chosenTopic = { topic: fallback.label, query: fallback.query, reason: 'fallback', confirmed: false };
  }

  console.log(`\n🎬 선정된 연예계 주제: ${chosenTopic.topic} (${chosenTopic.reason})`);

  // 3단계: 선정된 주제로 추가 RSS 수집 — 더 구체적인 팩트 확보
  const detailItems = await fetchNewsRSS(chosenTopic.query);
  const allItems = [...multiItems, ...detailItems]
    .filter((v, i, a) => a.findIndex(x => x.title === v.title) === i)
    .slice(0, 16);
  const newsContext = allItems.length > 0
    ? allItems.map((n, i) => `${i + 1}. ${n.title}\n   ${n.desc}`).join('\n\n')
    : `${chosenTopic.topic} 관련 최신 소식`;

  if (chosenTopic.reason === 'fallback') {
    const fallback = pickUnusedTopic(category);
    markTopicUsed(fallback.id);
  }

  // 4단계: 팩트 기반 상세 기사 작성 프롬프트
  const prompt = `당신은 10년 경력의 한국 드라마·예능 전문 블로거입니다. 아래 실시간 뉴스 데이터를 근거로 방영 중인 작품 소개/줄거리/화제 장면 중심의 글을 작성하세요.

날짜: ${today}
카테고리: 드라마·예능
오늘의 이슈: ${chosenTopic.topic}

【실시간 수집 뉴스 — 이 내용만을 사실로 사용할 것】:
${newsContext}

【절대 엄수 규칙】:
1. 위 뉴스에 실제로 나온 사실만 작성. 뉴스에 없는 내용을 창작하거나 추측으로 채우기 절대 금지.
2. 현재 방영 중인 드라마/예능 내용이면 줄거리, 출연진, 화제 장면, 시청률 중심으로 서술.
3. 확인되지 않은 내용은 "~로 알려졌어요", "~라는 보도가 있어요" 등 유보적 표현 사용.
4. 한국어로만 작성. 외국어(일본어/중국어/영어) 절대 금지.
5. "알아보겠습니다", "살펴보겠습니다", "이번 글에서는" 문장 시작 금지. 바로 핵심 내용으로 시작.
6. TONE: 반드시 "요/어요"체 구어체만 사용. "합니다", "입니다", "됩니다" 문장 종결 절대 금지. 예: "화제를 모으고 있어요", "확인됐어요", "주목받고 있어요".
7. SHORT PARAGRAPHS: 각 <p>태그는 최대 3문장. 짧게 끊어서 가독성 확보.
8. 각 섹션은 400자 이상의 구체적 내용 (단순 나열이 아닌 깊이 있는 서술).
9. heroStats는 작품명, 방송사/OTT, 시청률 또는 화제 장면으로 구성.
10. FAQ 3~5개 포함: 독자들이 실제로 궁금해하는 질문과 답변 (요/어요체).

유효한 JSON만 응답 (코드블록/마크다운 없이):
{
  "title": "연예 이슈 중심의 SEO 제목 (45-65자, 인물명/작품명 포함)",
  "description": "독자의 호기심을 자극하는 메타 설명 (반드시 150-160자, 핵심 사실·수치·키워드 포함)",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "slug": "short-english-slug",
  "heroGradient": "linear-gradient(135deg, #4a044e, #86198f)",
  "heroEmoji": "🎬",
  "heroTag": "연예계 · ${today}",
  "heroStats": [
    {"label": "이슈 키워드1", "value": "확인된 팩트", "color": "#f472b6"},
    {"label": "이슈 키워드2", "value": "확인된 팩트", "color": "#fbbf24"},
    {"label": "이슈 키워드3", "value": "확인된 팩트", "color": "#c084fc"}
  ],
  "heroSubtext": "이 글에서 확인할 수 있는 것 (구체적으로)",
  "intro": "<p>[첫 문장: 오늘 이슈의 핵심을 임팩트 있게 요약] [배경 설명 2-3문장]</p><p>[이 글에서 다룰 내용 소개]</p>",
  "cards": [
    {
      "num": "01",
      "badge": "이슈 발생",
      "title": "사건/이슈의 핵심 제목",
      "body": "뉴스에서 확인된 경위를 구체적으로 서술 (5-6문장, 400자 이상)",
      "stat": "확인된 핵심 팩트",
      "statColor": "#f472b6",
      "bg": "linear-gradient(135deg, #4a044e, #86198f)"
    },
    {
      "num": "02",
      "badge": "반응 현황",
      "title": "팬/대중/업계의 반응",
      "body": "보도된 팬덤 반응, 온라인 반응, 업계 코멘트 (5-6문장, 400자 이상)",
      "stat": "반응 키워드",
      "statColor": "#fbbf24",
      "bg": "linear-gradient(135deg, #7c1d4f, #9d174d)"
    },
    {
      "num": "03",
      "badge": "상세 분석",
      "title": "이슈의 맥락과 배경",
      "body": "이슈의 의미, 과거 사례 비교, 연예계 내 영향 (5-6문장, 400자 이상)",
      "stat": "분석 키워드",
      "statColor": "#c084fc",
      "bg": "linear-gradient(135deg, #3b0764, #6b21a8)"
    },
    {
      "num": "04",
      "badge": "향후 전망",
      "title": "앞으로 주목해야 할 포인트",
      "body": "이후 일정, 예상 시나리오, 주목 포인트 (5-6문장, 400자 이상)",
      "stat": "전망 키워드",
      "statColor": "#818cf8",
      "bg": "linear-gradient(135deg, #1e1b4b, #312e81)"
    }
  ],
  "sections": [
    {
      "id": "section1",
      "heading": "🎭 [이슈 배경 — 구체적 제목]",
      "content": "<p>400자 이상. 뉴스 기반 이슈 배경 상세 설명. 인물/작품/상황을 구체적으로.</p><p>추가 경위 설명.</p><ul><li><strong>확인된 사실1:</strong> 설명</li><li><strong>확인된 사실2:</strong> 설명</li><li><strong>확인된 사실3:</strong> 설명</li></ul>"
    },
    {
      "id": "section2",
      "heading": "💬 [반응 및 현황 — 구체적 제목]",
      "content": "<p>400자 이상. 보도된 팬 반응, SNS 반응, 미디어 보도.</p><blockquote>보도된 핵심 발언이나 반응 인용</blockquote><p>추가 반응 내용.</p>"
    },
    {
      "id": "section3",
      "heading": "🔍 [이슈의 맥락과 의미 — 구체적 제목]",
      "content": "<p>400자 이상. 이슈가 갖는 의미, 연예계 내 영향, 과거 유사 사례.</p><p>추가 분석.</p>"
    },
    {
      "id": "section4",
      "heading": "📅 [향후 일정 및 전망]",
      "content": "<p>400자 이상. 공식 확인된 향후 일정, 예상 흐름, 독자가 주목해야 할 포인트.</p><p>추가 전망.</p>"
    },
    {
      "id": "checklist",
      "heading": "✅ 이 이슈의 핵심 포인트 3가지",
      "content": "<p>오늘 이슈를 정리한 핵심 포인트입니다.</p><ul><li><strong>1. [포인트1]:</strong> 뉴스에서 확인된 내용 기반 설명 (2-3문장)</li><li><strong>2. [포인트2]:</strong> 뉴스에서 확인된 내용 기반 설명 (2-3문장)</li><li><strong>3. [포인트3]:</strong> 뉴스에서 확인된 내용 기반 설명 (2-3문장)</li></ul><blockquote>한 줄 팩트 요약</blockquote>"
    }
  ],
  "faq": [
    {"question": "독자들이 실제로 궁금해하는 질문 1?", "answer": "뉴스 기반의 구체적 답변 (요/어요체, 2~3문장)"},
    {"question": "독자들이 실제로 궁금해하는 질문 2?", "answer": "뉴스 기반의 구체적 답변 (요/어요체, 2~3문장)"},
    {"question": "독자들이 실제로 궁금해하는 질문 3?", "answer": "뉴스 기반의 구체적 답변 (요/어요체, 2~3문장)"}
  ],
  "summary": ["🎬 핵심 이슈: 확인된 사실 요약", "💬 반응: 보도된 팬/대중 반응", "📅 다음: 공식 확인된 일정/포인트"],
  "references": ["출처 이름 1 (예: 연합뉴스 2026.03.30 보도, 공식 방송사 보도자료 등)", "출처 이름 2"],
  "readMinutes": 6
}`;

  const text = await callGroq(prompt, { maxTokens: 6000 });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('연예계 JSON을 찾을 수 없습니다');

  let data = JSON.parse(repairJson(jsonMatch[0]));
  data = sanitizeReviewData(data);
  data.category = base;
  data.date = today;

  if (!data.slug) data.slug = `ent-${today}`;
  data.slug = sanitizeSlug(data.slug) + '-' + getKSTDateTime();

  console.log(`   ✅ 완료: ${data.title}`);
  return data;
}

async function generateNewsArticle(category) {
  const today = getKSTDate();
  const base = category.split('_')[0];

  // 연예계는 전용 함수로 분기
  if (base === '연예계') return generateEntertainmentArticle(category);

  // 오늘 같은 카테고리 글이 이미 있으면 스킵 (동시 실행 중복 방지)
  const existingToday = getTodayCategoryPost(base, today);
  if (existingToday) {
    console.log(`⏭️ [${base}] 오늘(${today}) 이미 발행됨: ${existingToday} — 스킵`);
    return null;
  }

  // 1단계: 실시간 트렌딩 뉴스 수집
  console.log(`\n📡 실시간 뉴스 탐색 중: [${base}]`);
  const trendingItems = await fetchTrendingNews(category);
  const trendingContext = trendingItems.length > 0
    ? trendingItems.map((n, i) => `${i + 1}. ${n.title}\n   ${n.desc}`).join('\n\n')
    : '';

  // 2단계: 이미 다룬 주제 목록 (중복 방지)
  const usedTitles = getExistingPostTitles();
  const avoidList = usedTitles.length > 0
    ? `\nALREADY PUBLISHED (MUST NOT repeat):\n${usedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  // 3단계: AI가 오늘의 핫이슈에서 주제 선정 + 상세 RSS 추가 수집
  const topicPickPrompt = `당신은 한국 경제 뉴스 에디터입니다. 오늘의 트렌딩 뉴스 중 "${base}" 카테고리에 맞는 가장 흥미롭고 시의성 있는 주제 하나를 선정하세요.

오늘 날짜: ${today}
카테고리: ${base}
${avoidList ? `\n⛔ 아래 주제들은 오늘 이미 발행했으므로 절대 선택하지 마세요. 비슷한 주제도 금지입니다:\n${usedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n` : ''}
오늘의 실시간 트렌딩 뉴스:
${trendingContext || `${base} 관련 최신 뉴스`}

위 금지 목록과 완전히 다른 새로운 주제를 선택하세요. JSON으로만 응답: {"topic": "구체적 주제 (한국어, 30자 이내)", "query": "RSS 검색 키워드 (한국어, 10-20자)", "reason": "이 주제가 오늘 화제인 이유"}`;

  let chosenTopic = { topic: '', query: '', reason: '' };
  try {
    const pickText = await callGroq(topicPickPrompt, { maxTokens: 300, jsonMode: true });
    const parsed = JSON.parse(pickText.match(/\{[\s\S]*\}/)?.[0] || pickText);
    chosenTopic = { topic: parsed.topic || '', query: parsed.query || base, reason: parsed.reason || '' };
  } catch { chosenTopic = { topic: '', query: base, reason: '' }; }

  // 주제 미선정 시 TOPIC_POOL 폴백
  if (!chosenTopic.topic) {
    const fallback = pickUnusedTopic(category);
    chosenTopic = { topic: fallback.label, query: fallback.query, reason: 'fallback' };
  }

  console.log(`\n📰 선정된 주제: [${base}] ${chosenTopic.topic}`);
  if (chosenTopic.reason && chosenTopic.reason !== 'fallback') {
    console.log(`   └ 선정 이유: ${chosenTopic.reason}`);
  }

  // 4단계: 선정된 주제로 심층 RSS 수집
  const detailItems = await fetchNewsRSS(chosenTopic.query);
  const allNewsItems = [...trendingItems, ...detailItems]
    .filter((v, i, a) => a.findIndex(x => x.title === v.title) === i) // 중복 제거
    .slice(0, 8);
  const newsContext = allNewsItems.length > 0
    ? allNewsItems.map((n, i) => `${i + 1}. ${n.title}\n   ${n.desc}`).join('\n\n')
    : `${chosenTopic.topic} 관련 최신 동향`;

  // 사용 주제 기록 (TOPIC_POOL 기반 폴백일 때)
  if (chosenTopic.reason === 'fallback') {
    const fallback = pickUnusedTopic(category);
    markTopicUsed(fallback.id);
  }

  const SYSTEM_MSG = `당신은 '나만 모르는 요즘 소식(bloginfo360.com)' 블로그 운영자 김민주입니다.
경제·보험·세금·복지 분야를 10년째 다루는 전문 블로거로, 공식 자료를 바탕으로 독자가 바로 써먹을 수 있는 정보를 씁니다.

【글쓰기 스타일 — 이것이 당신의 정체성】
- 독자 옆에 앉아 설명하는 말투: "솔직히", "사실은요", "이게 헷갈리는 분들이 많은데", "생각보다 간단해요"
- 수치는 반드시 생활 맥락으로 환산: "연 0.25%p 인상 → 1억 대출 시 월 2만 원 추가 부담"
- 섹션마다 첫 문장 유형을 다르게: 수치 직격/독자 질문/반전 사실/직접 행동 제안 중 선택
- 중간에 독자에게 말 걸기: "혹시 이런 상황이신가요?", "이 부분이 핵심이에요.", "생각보다 많죠?"
- 예시는 구체적 인물 설정: "30대 직장인이라면", "1인 가구 기준으로 보면"

【절대 금지 — AI 감지 패턴】
- "알아보겠습니다", "살펴보겠습니다", "이번 글에서는", "함께 알아볼게요", "모색해보겠습니다"
- 모든 문장을 ~어요/~입니다로 끝내기 → ~죠, ~네요, ~군요, ~거든요, ~셨나요 등 다양하게
- 매 섹션 첫 문장에서 섹션 제목 단어 반복 금지
- 첫째/둘째/셋째 번호 반복 → 자연스러운 접속사(그런데/또한/특히/반면에) 사용
- 합니다/입니다/됩니다/드립니다 어미 사용 금지`;

  const prompt = `오늘 날짜: ${today}
카테고리: ${base}
주제 (반드시 이 주제로 작성): ${chosenTopic.topic}

【실시간 수집 뉴스 — 이 데이터만 사실로 사용, 뉴스에 없는 내용 창작 절대 금지】:
${newsContext}

【작성 규칙】
- 한국어 100% (외국어·한자·영단어 삽입 절대 금지)
- 각 <p>는 최대 3문장
- 실제 뉴스 수치 최소 3개 인용 (예시 수치 그대로 복사 금지)
- HTML 비교 표(<table>) 최소 1개 포함
- 섹션당 최소 500자 (HTML 태그 제외 순수 텍스트 기준)
- 마지막 섹션은 반드시 id="checklist", "지금 당장 할 수 있는 것 3가지" 체크리스트
- FAQ 3~5개: 독자가 진짜 궁금해할 질문 + 실용적 답변
- references 배열에 공식기관명 + 날짜 형식 출처 2개 이상

아래 JSON 형식으로만 응답 (마크다운 코드블록 없이 JSON만):
{
  "title": "제목 (50자 이내, 연도+핵심키워드+숫자/혜택+총정리 공식 활용)",
  "slug": "영문-소문자-하이픈 (날짜 제외, 주제 기반 3-5단어)",
  "metaDescription": "메타설명 (80~120자, 핵심키워드 자연 포함)",
  "heroGradient": "linear-gradient(135deg, #색상1, #색상2)",
  "heroEmoji": "카테고리에 맞는 이모지 1개",
  "heroTag": "${base} · ${today}",
  "heroStats": [
    {"label": "핵심지표명", "value": "실제수치", "color": "#색상코드"},
    {"label": "지표명2",   "value": "실제수치", "color": "#색상코드"},
    {"label": "지표명3",   "value": "실제수치", "color": "#색상코드"}
  ],
  "heroSubtext": "이 글 읽으면 얻는 것 (20자 이내, 구체적으로)",
  "intro": "<p>[첫 문장: 실제 수치나 독자 공감으로 즉시 시작 — '오늘은~' '알아보겠습니다' 절대 금지]</p><p>[이 글에서 다룰 핵심 3가지 간단히]</p>",
  "cards": [
    {"num": "01", "badge": "핵심 이슈", "title": "실제수치 포함 제목", "body": "4-5문장, 실제수치, 내 생활 영향 중심 (요/어요체)", "stat": "실제수치", "statColor": "#색상", "bg": "linear-gradient(135deg, #색상1, #색상2)"},
    {"num": "02", "badge": "영향 분석", "title": "실제수치 포함 제목", "body": "4-5문장", "stat": "실제수치", "statColor": "#색상", "bg": "linear-gradient(135deg, #색상1, #색상2)"},
    {"num": "03", "badge": "실전 대응", "title": "실제수치 포함 제목", "body": "4-5문장", "stat": "실제수치", "statColor": "#색상", "bg": "linear-gradient(135deg, #색상1, #색상2)"},
    {"num": "04", "badge": "전망",      "title": "실제수치 포함 제목", "body": "4-5문장", "stat": "실제수치", "statColor": "#색상", "bg": "linear-gradient(135deg, #색상1, #색상2)"}
  ],
  "sections": [
    {
      "id": "section1",
      "heading": "실제 섹션1 제목 (수치 포함 권장)",
      "content": "<p>[첫 문장: 수치 직격 — 예: '지난달 기준금리가 0.25%p 오르면서 변동금리 대출자는 월 2만 원 더 내게 됐어요.'] 500자 이상 실제 내용. 수치 3개 이상.</p><table><thead><tr><th>항목</th><th>A</th><th>B</th></tr></thead><tbody><tr><td>항목1</td><td>실제값</td><td>실제값</td></tr><tr><td>항목2</td><td>실제값</td><td>실제값</td></tr></tbody></table><p>표 해석 + 독자에게 말 걸기 포함. (예: '이 표에서 특히 눈에 띄는 건~')</p>"
    },
    {
      "id": "section2",
      "heading": "실제 섹션2 제목",
      "content": "<p>[첫 문장: 독자 질문 형식 — 예: '그런데 이게 나한테도 해당되는 걸까요?'] 500자 이상.</p><blockquote>핵심 인사이트나 중요 수치 강조</blockquote><p>추가 분석.</p><ul><li><strong>포인트1:</strong> 구체적 설명 2-3문장</li><li><strong>포인트2:</strong> 구체적 설명 2-3문장</li><li><strong>포인트3:</strong> 구체적 설명 2-3문장</li></ul>"
    },
    {
      "id": "section3",
      "heading": "실제 섹션3 제목",
      "content": "<p>[첫 문장: 반전/놀라운 사실 — 예: '실은 이 방법을 모르는 분들이 생각보다 많아요.'] 500자 이상. 수치 포함.</p><p>추가 분석 200자 이상.</p>"
    },
    {
      "id": "section4",
      "heading": "실제 섹션4 제목",
      "content": "<p>[첫 문장: 직접 행동 제안 — 예: '지금 당장 네이버에서 ~을 검색해보세요.'] 500자 이상.</p><p>구체적 사례와 수치.</p>"
    },
    {
      "id": "checklist",
      "heading": "✅ 지금 당장 할 수 있는 것 3가지",
      "content": "<p>읽고 나서 바로 실행할 수 있는 것들이에요.</p><ul><li><strong>1. [구체적 행동 제목]:</strong> 언제, 어떻게, 얼마나 — 2-3문장 (요/어요체)</li><li><strong>2. [구체적 행동 제목]:</strong> 2-3문장</li><li><strong>3. [구체적 행동 제목]:</strong> 2-3문장</li></ul><blockquote>핵심 한 줄 요약 (요/어요체)</blockquote>"
    }
  ],
  "faq": [
    {"question": "독자가 진짜 궁금해하는 질문 1?", "answer": "구체적·실용적 답변, 요/어요체, 2~3문장"},
    {"question": "질문 2?", "answer": "답변"},
    {"question": "질문 3?", "answer": "답변"}
  ],
  "summary": ["✅ 오늘 당장: 실제 행동 내용", "📌 핵심 팩트: 수치 포함 요약", "🔮 앞으로: 주목할 날짜/지표"],
  "references": ["출처기관명 — 문서제목 (YYYY.MM)", "출처기관명2 — 문서제목 (YYYY.MM)"],
  "readMinutes": 7
}`;

Respond with ONLY valid JSON (no code blocks, no markdown):
{
  "title": "구체적 수치 포함한 SEO 제목 (45-65자)",
  "description": "독자가 얻을 것을 명시한 메타 설명 (반드시 150-160자, 핵심 수치·날짜·키워드 포함)",
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
      "heading": "🔍 실제 섹션 제목을 여기에 (수치 포함, 예: 기준금리 0.25%p 인상이 대출이자에 미치는 영향)",
      "content": "<p>WRITE ACTUAL CONTENT HERE. 최소 300자. 수치 3개 이상 포함. 예시: 2026년 3월 한국은행이 기준금리를 0.25%p 인상하여 연 3.75%로 결정했다. 이에 따라 은행권 주택담보대출 금리는 평균 0.3%p 오른 연 5.2% 수준으로 상승할 전망이다. 대출 1억 원 기준 연간 이자 부담은 약 30만 원 증가한다.</p><table><thead><tr><th>대출 종류</th><th>인상 전</th><th>인상 후</th><th>월 이자 변화</th></tr></thead><tbody><tr><td>주택담보대출(변동)</td><td>연 4.9%</td><td>연 5.2%</td><td>+2.5만원</td></tr><tr><td>신용대출</td><td>연 6.1%</td><td>연 6.4%</td><td>+2.5만원</td></tr></tbody></table><p>이 표에서 알 수 있듯이, 변동금리 대출자라면 지금 당장 고정금리 전환을 검토해야 한다. 특히 대출 잔액이 2억 원 이상인 경우 연간 60만 원 이상의 추가 부담이 발생한다.</p>"
    },
    {
      "id": "section2",
      "heading": "💸 실제 두번째 섹션 제목",
      "content": "<p>WRITE ACTUAL CONTENT HERE. 최소 300자. 수치 포함.</p><blockquote>실제 핵심 인사이트나 중요 수치를 여기 작성</blockquote><p>실제 추가 분석 내용.</p><ul><li><strong>실제 포인트1:</strong> 구체적 수치와 함께 실제 설명 2-3문장</li><li><strong>실제 포인트2:</strong> 구체적 수치와 함께 실제 설명 2-3문장</li><li><strong>실제 포인트3:</strong> 구체적 수치와 함께 실제 설명 2-3문장</li></ul>"
    },
    {
      "id": "section3",
      "heading": "📊 실제 세번째 섹션 제목",
      "content": "<p>WRITE ACTUAL CONTENT HERE. 최소 300자. 반드시 수치 포함.</p><p>실제 추가 분석. 최소 150자 이상.</p>"
    },
    {
      "id": "section4",
      "heading": "🏦 실제 네번째 섹션 제목",
      "content": "<p>WRITE ACTUAL CONTENT HERE. 최소 300자.</p><p>실제 구체적 사례와 수치. 최소 150자 이상.</p>"
    },
    {
      "id": "checklist",
      "heading": "✅ 지금 당장 할 수 있는 것 3가지",
      "content": "<p>이 상황에서 오늘 바로 실행할 수 있는 행동이에요.</p><ul><li><strong>1. 실제 행동 제목:</strong> 언제, 어떻게, 얼마나 — 실제 구체적 설명 2-3문장 (요/어요체)</li><li><strong>2. 실제 행동 제목:</strong> 실제 구체적 설명 2-3문장 (요/어요체)</li><li><strong>3. 실제 행동 제목:</strong> 실제 구체적 설명 2-3문장 (요/어요체)</li></ul><blockquote>실제 핵심 한 줄 요약 (요/어요체)</blockquote>"
    }
  ],
  "faq": [
    {
      "question": "독자들이 실제로 궁금해하는 질문 1?",
      "answer": "구체적이고 실용적인 답변을 요/어요체로 2~3문장으로 작성해요."
    },
    {
      "question": "독자들이 실제로 궁금해하는 질문 2?",
      "answer": "구체적이고 실용적인 답변을 요/어요체로 2~3문장으로 작성해요."
    },
    {
      "question": "독자들이 실제로 궁금해하는 질문 3?",
      "answer": "구체적이고 실용적인 답변을 요/어요체로 2~3문장으로 작성해요."
    }
  ],
  "summary": ["✅ 오늘 당장: 실제 행동 내용", "📌 핵심 팩트: 실제 수치 포함 요약", "🔮 앞으로: 실제 주목할 날짜/지표"],
  "references": ["출처 이름 1 (예: 한국은행 보도자료 2026.03, 기획재정부 경제정책브리핑, 연합뉴스 2026.03.30 보도 등)", "출처 이름 2"],
  "readMinutes": 7
}`;

  const text = await callGroq(prompt, { maxTokens: 8000, systemMsg: SYSTEM_MSG });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON을 찾을 수 없습니다');

  let data = JSON.parse(repairJson(jsonMatch[0]));
  data = sanitizeReviewData(data); // 뉴스에도 외국어 제거 적용
  data.category = base;
  data.date = today;

  // 콘텐츠 품질 검증 — placeholder 텍스트 감지
  const PLACEHOLDER_PATTERNS = ['추가 설명', '구체적 설명', '표 해석 및 독자', '항목1', '항목2', 'WRITE ACTUAL', '300자 이상 본문', '포인트1', '포인트2'];
  if (data.sections) {
    for (const sec of data.sections) {
      const text = (sec.content || '').replace(/<[^>]*>/g, '');
      const hasPlaceholder = PLACEHOLDER_PATTERNS.some(p => text.includes(p));
      const tooShort = text.length < 300;
      if (hasPlaceholder || tooShort) {
        console.warn(`   ⚠️ 섹션 "${sec.heading}" 콘텐츠 품질 미달 (${text.length}자, placeholder: ${hasPlaceholder}) — 재생성 필요`);
        throw new Error(`콘텐츠 품질 미달: 섹션 "${sec.heading}"`);
      }
    }
  }

  if (!data.slug) data.slug = `${base}-${today}`;
  data.slug = sanitizeSlug(data.slug) + '-' + getKSTDateTime();

  console.log(`   ✅ 완료: ${data.title}`);

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
    // 중복 URL 제거 후 최대 5장
    const images = [...new Set(json.items.slice(0, 10).map(i => i.image).filter(Boolean))].slice(0, 5);

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

  const systemMsg = `당신은 대한민국 최고의 제품 소개 블로거입니다.
규칙:
1. 순수 한국어만 사용. 그 외 모든 외국어 절대 금지.
2. 영어 단어를 한국어 문장 중간에 절대 삽입 금지. "Narrow한", "recently", "Best", "Review" 같은 영단어 절대 금지. 반드시 "좁은 공간", "최근", "최고", "리뷰" 등 한국어로 대체.
3. 일본어(히라가나·가타카나), 중국어(한자), 러시아어(키릴 문자), 아랍어, 태국어 등 모든 외국 문자 절대 금지.
4. "автомобиль", "Машина" 같은 키릴 문자 절대 금지. 반드시 "자동차", "차량" 등 한국어로만 작성.
5. "알아보겠습니다" "살펴보겠습니다" "한 달 사용해봤습니다" "직접 사용해봤습니다" 금지.
6. "한 달 사용", "한달 후기", "실사용 후기", "직접 써봤습니다" 같은 표현 절대 금지. 제품 소개글·홍보글 스타일로 작성.
7. 비교표의 ○/× 대신 반드시 "있음"/"없음" 또는 구체적 한국어 값 사용.
8. 아래 AI 티 나는 문장 패턴 절대 금지:
   - "이 제품은 ~에게 이상적인 선택입니다"
   - "~할 뿐만 아니라"
   - "이는 ~을 보여주며"
   - "더 많은 편리함을 제공합니다"
   - "~에 최적화되어 있습니다"
   - "이 제품을 추천드립니다"
9. 비추천 대상은 뻔한 말 금지. "자동차 없는 분" 같은 당연한 말 절대 금지.
   대신 구체적 상황으로: "이미 고성능 유선 청소기 있으면 굳이 살 필요 없어요" 같은 실용적 조언 스타일.
10. 반드시 valid JSON으로만 응답.`;

  const productDesc = info.bodyText?.substring(0, 1500) || info.description || '';

  const prompt = `다음 제품의 구매 유도 리뷰를 작성하고 JSON으로 반환하세요.

제품명: ${info.title}
${finalPrice ? `가격: ${finalPrice}` : ''}
제품 설명: ${productDesc || '없음 (제품명 기반으로 창의적으로 작성)'}

===아래 JSON을 완성하세요. 각 섹션 content는 반드시 600자 이상 한국어로 빽빽하게 채우세요. 절대 짧게 쓰지 마세요.===

{
  "title": "제품별 SEO 최적화 제목 (50-65자). 매번 다른 패턴 사용. '한 달', '직접 사용', '실사용', '써봤습니다' 패턴 절대 금지. 예시 패턴: '[제품명] 이게 왜 인기인지 이제 알겠다', '[제품명] — 이 가격에 이 퀄리티 가능한 이유', '요즘 이 제품 왜 다들 사는지 이유 있었다 — [제품명]', '[제품명] 선물로 이게 정답인 이유', '[제품명] 완전 정복 — 스펙·가격·추천 대상 총정리', '지금 가장 핫한 [제품명] 구매 가이드'.",
  "productName": "${info.title}",
  "description": "반드시 150-160자 메타 설명. 제품명·가격·핵심 장점 포함. 구매 욕구 자극.",
  "keywords": ["핵심키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
  "hashtags": ["해시태그1", "해시태그2", "해시태그3", "해시태그4", "해시태그5", "해시태그6", "해시태그7", "해시태그8", "해시태그9", "해시태그10", "해시태그11", "해시태그12", "해시태그13", "해시태그14", "해시태그15", "해시태그16", "해시태그17", "해시태그18", "해시태그19", "해시태그20"],
  "slug": "영문-슬러그-review",
  "price": "${finalPrice || '네이버 최저가 확인'}",
  "intro": "3문단 HTML. 이 제품이 왜 주목받는지, 어떤 분들에게 필요한지, 핵심 특징 3가지 소개. '한 달', '직접 사용', '써봤습니다' 표현 금지. 홍보글·제품 소개글 스타일로. 각 문단 3줄 이상.",
  "pros": [
    "✨ 구체적 장점 1 (수치 포함)",
    "💡 구체적 장점 2",
    "🎯 구체적 장점 3",
    "🏆 구체적 장점 4",
    "🔥 구체적 장점 5",
    "💰 구체적 장점 6",
    "⭐ 구체적 장점 7",
    "🎁 구체적 장점 8"
  ],
  "cons": [
    "굳이 꼽자면 — 아주 사소한 점 1",
    "미세하게 아쉬운 점 2"
  ],
  "specs": [
    {"label": "스펙항목1", "value": "값"},
    {"label": "스펙항목2", "value": "값"},
    {"label": "스펙항목3", "value": "값"},
    {"label": "스펙항목4", "value": "값"},
    {"label": "스펙항목5", "value": "값"}
  ],
  "sections": [
    {
      "heading": "🎨 디자인 & 첫인상",
      "content": "[설명형 문체로 작성. 600자 이상 필수. <p>본문 3줄 이상</p><p>추가 설명 2줄 이상</p><ul><li><strong>포인트1:</strong> 구체적 설명</li><li><strong>포인트2:</strong> 구체적 설명</li></ul><blockquote>핵심 한 줄</blockquote> 구조로 작성]"
    },
    {
      "heading": "✅ 핵심 기능 & 성능",
      "content": "[홍보 문체로 작성. 600자 이상 필수. <p>기능 설명 3줄 이상</p><p>성능 설명 2줄 이상</p><ul><li><strong>기능1:</strong> 수치 포함 설명</li><li><strong>기능2:</strong> 구체적 설명</li><li><strong>기능3:</strong> 구체적 설명</li></ul> 구조로 작성]"
    },
    {
      "heading": "📦 구성품 & 사용법",
      "content": "[안내형 문체로 작성. 600자 이상 필수. <p>구성품 소개</p><p>사용 방법 안내</p><ul><li>구성품1</li><li>구성품2</li></ul><p>사용 시 주의사항 또는 팁</p> 구조로 작성]"
    },
    {
      "heading": "💰 가격 대비 가치 분석",
      "content": "[분석형 문체로 작성. 600자 이상 필수. <p>가격 분석 3줄</p><table><thead><tr><th>항목</th><th>이 제품</th><th>유사 제품</th></tr></thead><tbody><tr><td>항목1</td><td>값</td><td>값</td></tr><tr><td>항목2</td><td>값</td><td>값</td></tr><tr><td>항목3</td><td>값</td><td>값</td></tr></tbody></table><p>비교 결론 2줄</p> 구조로 작성]"
    },
    {
      "heading": "🛒 구매 전 꼭 확인하세요",
      "content": "[안내형 문체로 작성. 600자 이상 필수. <p>구매 시 주의사항</p><ul><li>확인사항1</li><li>확인사항2</li><li>확인사항3</li></ul><p>보관·관리 방법</p><blockquote>구매 결정 도움말</blockquote> 구조로 작성]"
    },
    {
      "heading": "🙋 이런 분께 딱 맞아요",
      "content": "[친근한 대화체로 작성. 600자 이상 필수. AI 티 나는 문장 절대 금지. <p>어떤 상황의 사람에게 잘 맞는지 구체적으로 2~3줄</p><ul><li>추천 상황1 — 왜 잘 맞는지 이유까지</li><li>추천 상황2 — 왜 잘 맞는지 이유까지</li><li>추천 상황3 — 왜 잘 맞는지 이유까지</li></ul><p>비추천 대상: 당연한 말 금지. 예) '자동차 없는 분' 같은 뻔한 말 대신, 이미 비슷한 제품이 있거나 이 제품이 굳이 필요 없는 구체적인 상황을 솔직하게 2줄</p><blockquote>짧고 임팩트 있는 한 줄 마무리</blockquote> 구조로 작성]"
    }
  ],
  "rating": 4.6,
  "summary": [
    "🏆 핵심 장점: 구체적으로",
    "💡 이런 분께 강추: 구체적 상황",
    "🎁 의외의 장점: 예상 못한 좋은 점",
    "⚡ 구매 포인트: 지금 사야 하는 이유"
  ],
  "targetUser": "이 제품이 딱 맞는 구체적인 사람 2줄 묘사",
  "readMinutes": 8
}`;

  const text = await callGroq(prompt, { maxTokens: 12000, jsonMode: false, systemMsg });

  // JSON 추출 (코드블록 포함 대응)
  const rawJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON 파싱 실패 — 응답:\n' + text.substring(0, 400));

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch {
    // 제어문자 수정 후 재시도
    try {
      data = JSON.parse(repairJson(jsonMatch[0]));
    } catch (e2) {
      throw new Error('JSON 파싱 오류: ' + e2.message + '\n응답:\n' + text.substring(0, 400));
    }
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

  const ogImage = getCategoryOgImage(data.category);
  const postUrl = `https://bloginfo360.com/posts/${data.slug}/`;
  const wordCount = Math.round(
    (data.description || '').length +
    (data.sections || []).reduce((a, s) => a + (s.content || '').replace(/<[^>]*>/g, '').length, 0)
  );

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js" defer></script>
  <title>${escHtml(data.title)} - 나만 모르는 요즘 소식</title>
  <meta name="description" content="${escAttr(data.description)}">
  <meta name="keywords" content="${escAttr((data.keywords || []).join(', '))}">
  <meta name="robots" content="index, follow">
  <meta name="google-adsense-account" content="ca-pub-1954893264438671">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1954893264438671" crossorigin="anonymous"></script>
  <link rel="canonical" href="${postUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escAttr(data.title)}">
  <meta property="og:description" content="${escAttr(data.description)}">
  <meta property="og:url" content="${postUrl}">
  <meta property="og:locale" content="ko_KR">
  <meta property="article:published_time" content="${data.date}T09:00:00+09:00">
  <meta property="article:section" content="${escAttr(data.category)}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(data.title)}">
  <meta name="twitter:description" content="${escAttr(data.description)}">
  <meta name="twitter:image" content="${ogImage}">
  <script type="application/ld+json">
  [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": ${JSON.stringify(data.title)},
      "description": ${JSON.stringify(data.description)},
      "datePublished": "${data.date}",
      "dateModified": "${data.date}",
      "inLanguage": "ko-KR",
      "wordCount": ${wordCount},
      "image": "${ogImage}",
      "author": { "@type": "Person", "name": "김민주", "url": "https://bloginfo360.com/about" },
      "publisher": { "@type": "Organization", "name": "나만 모르는 요즘 소식", "url": "https://bloginfo360.com", "logo": { "@type": "ImageObject", "url": "https://bloginfo360.com/og-default.svg" } },
      "mainEntityOfPage": { "@type": "WebPage", "@id": "${postUrl}" }
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "홈", "item": "https://bloginfo360.com/" },
        { "@type": "ListItem", "position": 2, "name": ${JSON.stringify(data.category)}, "item": "https://bloginfo360.com/#${escAttr(data.category)}" },
        { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(data.title)}, "item": "${postUrl}" }
      ]
    }
  ]
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

        <!-- AdSense 인콘텐츠 광고 -->
        <div class="my-8">
          <ins class="adsbygoogle"
               style="display:block; text-align:center;"
               data-ad-layout="in-article"
               data-ad-format="fluid"
               data-ad-client="ca-pub-1954893264438671"
               data-ad-slot="2954893264"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
        </div>

        <!-- 핵심 요약 -->
        <div class="mt-10 bg-brand-50 border border-brand-100 rounded-2xl p-6">
          <h3 class="font-bold text-brand-700 mb-3 text-base">📌 핵심 요약</h3>
          <ul class="space-y-2 text-sm text-ink-700">
            ${summaryHTML}
          </ul>
        </div>

        ${(data.faq && data.faq.length) ? `
        <!-- FAQ -->
        <div class="mt-10 bg-white border border-ink-100 rounded-2xl p-6">
          <h2 class="font-black text-ink-900 text-lg mb-5">❓ 자주 묻는 질문</h2>
          <div class="space-y-4">
            ${(data.faq || []).map((q, i) => `
            <div class="border-b border-ink-100 pb-4 last:border-0 last:pb-0">
              <p class="font-bold text-ink-900 text-sm mb-1.5">Q${i + 1}. ${escHtml(q.question)}</p>
              <p class="text-ink-500 text-sm leading-relaxed">A. ${escHtml(q.answer)}</p>
            </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- AdSense 디스플레이 광고 (하단) -->
        <div class="my-8">
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-1954893264438671"
               data-ad-slot="2954893265"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
        </div>

        ${buildSourcesHTML(data)}
        ${authorBox()}

        <!-- 해시태그 -->
        <div class="mt-8 flex flex-wrap gap-2">
          ${hashtagsHTML}
        </div>

        ${buildRelatedPostsHTML(data.slug, data.category)}

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
  const consHTML = (data.cons || []).map(c => `<li>${escHtml(c)}</li>`).join('\n');
  const specsHTML = (data.specs || []).map(s =>
    `<tr><td><strong>${escHtml(s.label)}</strong></td><td>${escHtml(s.value)}</td></tr>`
  ).join('\n');
  const summaryHTML = (data.summary || []).map(s => `<li>${escHtml(s)}</li>`).join('\n');

  // 중복 제거 + 최대 5장
  const rawImages = data.productImages?.length > 0 ? data.productImages : (data.productImage ? [data.productImage] : []);
  const uniqueImages = [...new Set(rawImages)].slice(0, 5);

  // 이미지 태그 생성 헬퍼
  const imgTag = (src, alt) => src
    ? `<div class="my-8 rounded-2xl overflow-hidden bg-gray-50 border border-ink-100">
        <img src="${escAttr(src)}" alt="${escAttr(alt || data.productName || '제품')}" class="w-full object-contain max-h-80" loading="lazy">
       </div>`
    : '';

  // 섹션 + 이미지를 교차 배치 (이미지는 섹션 사이, 섹션 내부 아님)
  const sections = data.sections || [];
  let sectionsHTML = '';
  sections.forEach((s, i) => {
    sectionsHTML += `
<div class="review-section">
  <div class="prose">
    <h2>${escHtml(s.heading)}</h2>
    ${s.content || ''}
  </div>
</div>`;
    // 섹션 다음에 이미지 삽입 (첫 번째 이미지는 상단에 사용하므로 index+1)
    if (uniqueImages[i + 1]) {
      sectionsHTML += imgTag(uniqueImages[i + 1], `${data.productName} 사진 ${i + 2}`);
    }
  });

  const heroImageHTML = uniqueImages[0]
    ? `<div class="rounded-2xl overflow-hidden bg-gray-50 border border-ink-100 mb-8">
        <img src="${escAttr(uniqueImages[0])}" alt="${escAttr(data.productName || '제품')}" class="w-full object-contain max-h-96" loading="lazy">
       </div>`
    : `<div class="w-full rounded-2xl mb-8 bg-ink-100 flex items-center justify-center" style="height:200px;"><span class="text-6xl">📦</span></div>`;

  const stars = '⭐'.repeat(Math.round(Math.min(5, Math.max(1, data.rating || 4))));
  const btnLabel = data.platform === 'coupang' ? '쿠팡에서 보기' : '네이버에서 보기';
  const btnLabel2 = data.platform === 'coupang' ? '쿠팡에서 구매하기' : '네이버에서 구매하기';

  const reviewOgImage = data.productImage || getCategoryOgImage('제품리뷰');
  const reviewUrl = `https://bloginfo360.com/posts/${data.slug}/`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js" defer></script>
  <title>${escHtml(data.title)} - 나만 모르는 요즘 소식</title>
  <meta name="description" content="${escAttr(data.description)}">
  <meta name="keywords" content="${escAttr((data.keywords || []).join(', '))}">
  <meta name="robots" content="index, follow">
  <meta name="google-adsense-account" content="ca-pub-1954893264438671">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1954893264438671" crossorigin="anonymous"></script>
  <link rel="canonical" href="${reviewUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escAttr(data.title)}">
  <meta property="og:description" content="${escAttr(data.description)}">
  <meta property="og:url" content="${reviewUrl}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:image" content="${reviewOgImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(data.title)}">
  <meta name="twitter:description" content="${escAttr(data.description)}">
  <meta name="twitter:image" content="${reviewOgImage}">
  <script type="application/ld+json">
  [
    {
      "@context": "https://schema.org",
      "@type": "Review",
      "headline": ${JSON.stringify(data.title)},
      "description": ${JSON.stringify(data.description)},
      "datePublished": "${data.date}",
      "inLanguage": "ko-KR",
      "author": { "@type": "Person", "name": "김민주", "url": "https://bloginfo360.com/about" },
      "reviewRating": { "@type": "Rating", "ratingValue": "${data.rating || 4}", "bestRating": "5" },
      "mainEntityOfPage": { "@type": "WebPage", "@id": "${reviewUrl}" }
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "홈", "item": "https://bloginfo360.com/" },
        { "@type": "ListItem", "position": 2, "name": "제품리뷰", "item": "https://bloginfo360.com/#제품리뷰" },
        { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(data.title)}, "item": "${reviewUrl}" }
      ]
    }
  ]
  </script>
  ${commonHead()}
  <style>
    .btn-affiliate { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:16px 32px; border-radius:14px; font-size:1.05rem; font-weight:800; background:#16a34a; color:white; text-decoration:none; transition:background 0.15s, transform 0.1s; width:100%; max-width:360px; }
    .btn-affiliate:hover { background:#15803d; transform:scale(1.02); }
    .btn-affiliate:active { transform:scale(0.98); }
    .review-section { margin-bottom:2.5rem; }
    .review-section .prose h2 { font-size:1.25rem; }
    .callout { background:#f0fdf4; border-left:4px solid #16a34a; border-radius:0 12px 12px 0; padding:16px 20px; margin:1.5rem 0; }
    .callout p { margin:0; color:#1e293b; font-size:0.95rem; line-height:1.8; }
    .highlight-box { background:linear-gradient(135deg,#f0fdf4,#dcfce7); border:1px solid #bbf7d0; border-radius:14px; padding:20px 24px; margin:2rem 0; }
  </style>
</head>
<body class="bg-white text-ink-900">
  ${header()}
  <main class="max-w-3xl mx-auto px-4 py-10">

    <!-- 제휴 마케팅 고지 -->
    <div class="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-6 text-xs text-amber-700">
      ⚠️ ${escHtml(data.disclaimer)}
    </div>

    <!-- 카테고리 + 날짜 -->
    <div class="flex flex-wrap gap-2 items-center mb-3">
      <span class="text-xs font-bold text-gold-500 bg-yellow-50 px-2.5 py-0.5 rounded-full">📦 제품리뷰</span>
      <span class="text-xs text-ink-300">${data.date} · 읽는 시간 약 ${data.readMinutes || 5}분</span>
    </div>

    <!-- 제목 -->
    <h1 class="text-2xl sm:text-3xl font-black text-ink-900 leading-tight mb-3">${escHtml(data.title)}</h1>
    <p class="text-ink-500 text-sm mb-6 leading-relaxed">${escHtml(data.description)}</p>

    <!-- 평점 + 가격 -->
    <div class="flex items-center justify-between gap-3 mb-6 p-4 bg-ink-100/40 rounded-2xl flex-wrap">
      <div class="flex items-center gap-2">
        <span class="text-xl">${stars}</span>
        <span class="font-black text-2xl text-ink-900">${data.rating}</span>
        <span class="text-sm text-ink-400">/ 5.0</span>
      </div>
      ${data.price ? `<div class="text-right"><p class="text-xs text-ink-300 mb-0.5">현재 최저가</p><p class="font-black text-2xl text-brand-600">${escHtml(data.price)}</p></div>` : ''}
    </div>

    <!-- 메인 이미지 -->
    ${heroImageHTML}

    <!-- 구매 버튼 (상단) -->
    <div class="flex justify-center mb-10">
      <a href="${escAttr(data.affiliateUrl)}" target="_blank" rel="noopener sponsored" class="btn-affiliate">🛒 ${btnLabel} →</a>
    </div>

    <!-- 도입부 -->
    <div class="prose mb-8">${data.intro || ''}</div>

    <!-- 장점 -->
    <div class="bg-green-50 border border-green-100 rounded-2xl p-6 mb-3">
      <h3 class="font-bold text-green-700 mb-4 text-base">👍 이런 점이 좋았어요</h3>
      <ul class="space-y-2.5 text-sm text-ink-700">${prosHTML}</ul>
    </div>

    <!-- 아쉬운 점 (접힘) -->
    <details class="mb-8">
      <summary class="text-xs text-ink-300 cursor-pointer select-none py-1">🤔 굳이 꼽자면 아쉬운 점</summary>
      <div class="mt-2 pl-3 border-l-2 border-ink-100">
        <ul class="space-y-1 text-xs text-ink-300">${consHTML}</ul>
      </div>
    </details>

    ${specsHTML ? `<div class="prose mb-8"><h2>📋 제품 스펙</h2><table><tbody>${specsHTML}</tbody></table></div>` : ''}

    <!-- 본문 섹션 + 이미지 교차 -->
    ${sectionsHTML}

    <!-- 핵심 요약 -->
    <div class="mt-10 highlight-box">
      <h3 class="font-bold text-green-700 mb-3 text-base">📌 이런 분께 강력 추천해요</h3>
      <p class="text-sm text-ink-700 mb-4 leading-relaxed">${escHtml(data.targetUser || '')}</p>
      <ul class="space-y-2 text-sm text-ink-700">${summaryHTML}</ul>
    </div>

    <!-- 구매 버튼 (하단) -->
    <div class="flex flex-col items-center gap-3 mt-10">
      <a href="${escAttr(data.affiliateUrl)}" target="_blank" rel="noopener sponsored" class="btn-affiliate">🛒 ${btnLabel2} →</a>
      <p class="text-xs text-ink-300 text-center">${escHtml(data.disclaimer)}</p>
    </div>

    ${authorBox()}

    <!-- 해시태그 -->
    <div class="mt-8 flex flex-wrap gap-2">
      ${(data.hashtags || data.keywords || []).map(k => `<span class="text-xs text-ink-500 bg-ink-100 px-2.5 py-1 rounded-full">#${escHtml(k.replace(/\s+/g, '').replace(/^#/, ''))}</span>`).join('\n      ')}
    </div>

    ${buildRelatedPostsHTML(data.slug, data.category)}

    <!-- 공유 -->
    <div class="mt-4 pt-6 border-t border-ink-100 flex flex-wrap gap-3">
      <button class="btn-share" onclick="navigator.clipboard.writeText(location.href).then(()=>alert('✅ 링크 복사 완료!'))">🔗 링크 복사</button>
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
  '보험':    { emoji: '💼', tagColor: '#3b82f6', tagBg: 'rgba(59,130,246,0.15)',  cardBg: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)' },
  '세금':    { emoji: '💸', tagColor: '#f97316', tagBg: 'rgba(249,115,22,0.15)', cardBg: 'linear-gradient(135deg,#7c2d12,#c2410c)' },
};

function buildPostCard(data) {
  const cfg = CAT_CONFIG[data.category] || CAT_CONFIG['경제'];
  const dateStr = data.date.replace(/-/g, '.');
  const shortDesc = (data.description || '').substring(0, 80) + '...';
  const isReview = data.category === '제품리뷰';

  // 뉴스: heroStats 첫 번째 지표 표시 / 제품리뷰: 가격 + 평점 표시
  let coverInner = '';
  if (isReview) {
    const stars = data.rating ? '★'.repeat(Math.round(data.rating)) + ' ' + data.rating : '';
    coverInner = `
            <div>
              ${stars ? `<p style="color:#fbbf24;" class="font-black text-lg leading-tight">${escHtml(stars)}</p>` : ''}
              ${data.price ? `<p style="color:#34d399;" class="font-black text-2xl leading-tight">${escHtml(data.price)}</p>` : ''}
              <p class="text-white font-bold text-sm leading-snug mt-1 line-clamp-2">${escHtml(data.productName || data.title)}</p>
            </div>`;
  } else {
    const stat = (data.heroStats || [])[0];
    const subtext = data.heroSubtext || '';
    coverInner = `
            <div>
              ${stat ? `<p class="text-white/60 text-xs mb-0.5">${escHtml(stat.label)}</p>
              <p style="color:${stat.color || '#f87171'};" class="font-black text-3xl leading-tight">${escHtml(stat.value)}</p>` : `<p class="text-white font-black text-base leading-tight line-clamp-2">${escHtml(data.title)}</p>`}
              ${subtext ? `<p class="text-white/50 text-xs mt-1 line-clamp-1">${escHtml(subtext)}</p>` : ''}
            </div>`;
  }

  return `
      <!-- AUTO: ${data.title} -->
      <a href="posts/${data.slug}" class="block no-underline"><article class="post-item post-card rounded-2xl border border-ink-100 overflow-hidden bg-white shadow-card cursor-pointer"
               data-category="${escAttr(data.category)}" data-title="${escAttr(data.title)}">
        <div class="h-44 relative overflow-hidden" style="background:${cfg.cardBg};">
          <div class="absolute inset-0 flex flex-col justify-between p-4">
            <div class="flex items-center justify-between">
              <span style="background:${cfg.tagBg};color:${cfg.tagColor};" class="text-xs font-bold px-2 py-0.5 rounded-full border border-white/10">${cfg.emoji} ${escHtml(data.category)}</span>
              <span class="text-xs text-white/40">${dateStr}</span>
            </div>
            ${coverInner}
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
      </article></a>`;
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
    <loc>https://bloginfo360.com/posts/${data.slug}/</loc>
    <lastmod>${data.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;

  // 신규 포스트 추가
  xml = xml.replace('</urlset>', newEntry + '\n</urlset>');

  // 루트 페이지 lastmod 실시간 업데이트
  xml = xml.replace(
    /(<loc>https:\/\/bloginfo360\.com\/<\/loc>\s*<lastmod>)[^<]*/,
    `$1${data.date}`
  );

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

function getKSTDateTime() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().split('T')[0];
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${date}-${hour}${min}`;
}

// 오늘 날짜 + 카테고리로 이미 발행된 포스트 파일명 반환 (동시 실행 중복 방지용)
function getTodayCategoryPost(category, date) {
  try {
    const postsDir = path.join(ROOT, 'posts');
    if (!existsSync(postsDir)) return null;
    const files = readdirSync(postsDir).filter(f => f.endsWith('.html') && f !== '_template.html');
    for (const file of files) {
      try {
        const content = readFileSync(path.join(postsDir, file), 'utf-8');
        const dateMatch = content.match(/article:published_time[^>]*content="(\d{4}-\d{2}-\d{2})/);
        const catMatch = content.match(/article:section[^>]*content="([^"]+)"/);
        if (dateMatch?.[1] === date && catMatch?.[1] === category) return file;
      } catch { continue; }
    }
    return null;
  } catch { return null; }
}

// 관련 글 HTML 생성 (같은 카테고리 우선, 현재 슬러그 제외)
function buildRelatedPostsHTML(currentSlug, currentCategory) {
  try {
    const postsDir = path.join(ROOT, 'posts');
    if (!existsSync(postsDir)) return '';
    const files = readdirSync(postsDir)
      .filter(f => f.endsWith('.html') && f !== '_template.html' && !f.includes('_'))
      .sort().reverse().slice(0, 30);

    const sameCat = [];
    const otherCat = [];
    for (const file of files) {
      const slug = file.replace('.html', '');
      if (slug === currentSlug) continue;
      try {
        const content = readFileSync(path.join(postsDir, file), 'utf-8');
        const titleM = content.match(/<title>([^<]+)<\/title>/);
        const descM = content.match(/<meta name="description" content="([^"]+)"/);
        const catM = content.match(/article:section[^>]*content="([^"]+)"/);
        const dateM = content.match(/article:published_time[^>]*content="(\d{4}-\d{2}-\d{2})/);
        if (!titleM) continue;
        const post = {
          slug,
          title: titleM[1].replace(/\s*[-|].*$/, '').trim(),
          desc: descM?.[1] || '',
          category: catM?.[1] || '',
          date: dateM?.[1] || '',
        };
        if (currentCategory && post.category === currentCategory) {
          sameCat.push(post);
        } else {
          otherCat.push(post);
        }
      } catch { continue; }
    }

    // 같은 카테고리 우선 최대 2개, 나머지 1개는 다른 카테고리
    const pool = [
      ...sameCat.sort(() => 0.5 - Math.random()).slice(0, 2),
      ...otherCat.sort(() => 0.5 - Math.random()).slice(0, 1),
    ].slice(0, 3);

    const posts = pool;

    if (posts.length === 0) return '';

    const selected = posts;
    const cards = selected.map(p => `
          <a href="/posts/${p.slug}" class="block rounded-xl border border-ink-100 p-4 hover:border-brand-300 hover:bg-brand-50 transition-colors">
            <span class="text-xs font-bold text-gold-500 bg-yellow-50 px-2 py-0.5 rounded-full">${escHtml(p.category)}</span>
            <p class="mt-2 font-bold text-ink-900 text-sm leading-snug line-clamp-2">${escHtml(p.title)}</p>
            <p class="mt-1 text-xs text-ink-400 line-clamp-2">${escHtml(p.desc)}</p>
            <p class="mt-2 text-xs text-ink-300">${p.date}</p>
          </a>`).join('\n');

    return `
        <!-- 관련 글 -->
        <div class="mt-10 pt-8 border-t border-ink-100">
          <h3 class="font-bold text-ink-700 text-base mb-4">📚 관련 글</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            ${cards}
          </div>
        </div>`;
  } catch { return ''; }
}

// 기존 포스트 제목 수집 (중복 주제 방지용) - 최근 30개
function getExistingPostTitles() {
  try {
    const postsDir = path.join(ROOT, 'posts');
    if (!existsSync(postsDir)) return [];
    const files = readdirSync(postsDir)
      .filter(f => f.endsWith('.html') && f !== '_template.html')
      .sort()
      .slice(-30); // 최근 30개만
    const titles = [];
    for (const file of files) {
      try {
        const content = readFileSync(path.join(postsDir, file), 'utf-8');
        const m = content.match(/<title>([^<]+)<\/title>/);
        if (m) titles.push(m[1].replace(/\s*\|.*$/, '').trim());
      } catch { /* skip */ }
    }
    return titles;
  } catch { return []; }
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
      <a href="../index.html" class="text-xl font-black text-brand-600 leading-tight">나만 모르는<br class="sm:hidden"> 요즘 소식</a>
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
    <p>© 2026 나만 모르는 요즘 소식. All rights reserved.</p>
    <p class="mt-1">운영자: 김민주 &nbsp;|&nbsp; <a href="mailto:mju427@naver.com" class="hover:text-brand-600">mju427@naver.com</a> &nbsp;|&nbsp; <a href="../about.html" class="hover:text-brand-600">소개</a> &nbsp;|&nbsp; <a href="../privacy.html" class="hover:text-brand-600">개인정보처리방침</a></p>
    <p class="mt-1"><a href="../index.html" class="hover:text-brand-600">홈으로 돌아가기</a></p>
  </footer>`;
}

// 저자 박스
function authorBox() {
  return `
        <div class="mt-8 p-5 bg-gray-50 border border-ink-100 rounded-2xl flex items-start gap-4">
          <div class="w-12 h-12 rounded-full bg-brand-600 flex items-center justify-center text-white font-black text-lg shrink-0">민</div>
          <div>
            <p class="font-bold text-ink-900 text-sm">김민주</p>
            <p class="text-xs text-brand-600 font-semibold mt-0.5">나만 모르는 요즘 소식 운영자</p>
            <p class="text-xs text-ink-400 mt-2 leading-relaxed">경제·재테크·복지정책 분야의 공식 자료와 최신 뉴스를 기반으로 정보를 정리합니다. 오류 제보 및 문의: <a href="mailto:mju427@naver.com" class="text-brand-600 underline underline-offset-2">mju427@naver.com</a></p>
          </div>
        </div>`;
}

// 카테고리별 OG 이미지
function getCategoryOgImage(category) {
  const map = {
    '경제':     'https://bloginfo360.com/og-economy.svg',
    '주식':     'https://bloginfo360.com/og-stock.svg',
    '부동산':   'https://bloginfo360.com/og-realestate.svg',
    '복지정책': 'https://bloginfo360.com/og-welfare.svg',
    '제품리뷰': 'https://bloginfo360.com/og-review.svg',
    '보험':     'https://bloginfo360.com/og-default.svg',
    '세금':     'https://bloginfo360.com/og-default.svg',
  };
  return map[category] || 'https://bloginfo360.com/og-default.svg';
}

// 출처 및 공식 링크 섹션
const OFFICIAL_LINKS = {
  '복지정책': [
    { name: '복지로 (정부 복지서비스 포털)', url: 'https://www.bokjiro.go.kr' },
    { name: '보건복지부', url: 'https://www.mohw.go.kr' },
  ],
  '세금': [
    { name: '국세청 홈택스', url: 'https://www.hometax.go.kr' },
    { name: '국세청', url: 'https://www.nts.go.kr' },
  ],
  '금융': [
    { name: '금융감독원 파인', url: 'https://fine.fss.or.kr' },
    { name: '금융위원회', url: 'https://www.fsc.go.kr' },
  ],
  '경제': [
    { name: '한국은행', url: 'https://www.bok.or.kr' },
    { name: '기획재정부', url: 'https://www.moef.go.kr' },
  ],
  '주식': [
    { name: '한국거래소 (KRX)', url: 'https://www.krx.co.kr' },
    { name: '금융감독원 전자공시 (DART)', url: 'https://dart.fss.or.kr' },
  ],
  '부동산': [
    { name: '국토교통부 실거래가 공개', url: 'https://rt.molit.go.kr' },
    { name: '청약홈', url: 'https://www.applyhome.co.kr' },
  ],
};

function buildSourcesHTML(data) {
  const refs = data.references || [];
  const official = OFFICIAL_LINKS[data.category] || [];
  if (refs.length === 0 && official.length === 0) return '';

  let html = `\n        <div class="mt-8 pt-6 border-t border-ink-100">`;

  if (refs.length > 0) {
    const refsHTML = refs.map(r => `<li class="text-xs text-ink-500 leading-relaxed">${escHtml(r)}</li>`).join('\n            ');
    html += `
          <p class="text-xs font-bold text-ink-700 mb-2">📰 참고 자료</p>
          <ul class="space-y-1 mb-4 list-disc list-inside">${refsHTML}</ul>`;
  }

  if (official.length > 0) {
    const linksHTML = official.map(s =>
      `<a href="${escAttr(s.url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs bg-white border border-ink-100 hover:border-brand-600 text-ink-600 hover:text-brand-600 px-3 py-1.5 rounded-lg transition-colors">${escHtml(s.name)} ↗</a>`
    ).join('\n            ');
    html += `
          <p class="text-xs font-bold text-ink-700 mb-2">🏛️ 공식 사이트에서 직접 확인하세요</p>
          <div class="flex flex-wrap gap-2">${linksHTML}</div>`;
  }

  html += `\n        </div>`;
  return html;
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
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) console.log(`\n🔄 [${category}] 재시도 ${attempt}/3...`);
          const data = await generateNewsArticle(category);
          if (!data) { success = true; await sleep(1000); break; } // 중복 스킵 → 정상 처리
          const html = buildNewsHTML(data);
          savePost(data, html);
          updateIndexHTML(data);
          updateSitemap(data);
          console.log(`\n✅ [${category}] 완료: ${data.title}`);
          success = true;
          break;
        } catch (e) {
          console.error(`\n❌ [${category}] 시도 ${attempt} 실패:`, e.message);
          if (attempt < 3) await sleep(5000);
        }
      }
      if (!success) console.error(`\n🚫 [${category}] 3회 재시도 후 최종 실패`);
      await sleep(3000); // API rate limit 방지
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
