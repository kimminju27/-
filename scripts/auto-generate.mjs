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
  // 금융
  { id: 'fin-001', category: '금융', label: '고금리 예금 적금 특판 비교', query: '예금 적금 특판 고금리 은행 금리비교' },
  { id: 'fin-002', category: '금융', label: 'ISA 계좌 절세 투자 활용법', query: 'ISA 계좌 절세 비과세 투자 활용 방법' },
  { id: 'fin-003', category: '금융', label: '주택담보대출 금리 대환대출', query: '주택담보대출 금리 대환대출 은행 비교' },
  { id: 'fin-004', category: '금융', label: '신용점수 올리는 방법', query: '신용점수 신용등급 올리기 관리 방법' },
  { id: 'fin-005', category: '금융', label: '청년 우대형 청약통장', query: '청년 우대형 청약통장 금리 가입 조건' },
  { id: 'fin-006', category: '금융', label: '소액 투자 재테크 시작법', query: '소액 투자 재테크 시작 초보 방법 추천' },
  // 연예계 — 방영 중 드라마/예능 중심
  { id: 'ent-001', category: '연예계', label: '방영중 드라마 화제 장면', query: '방영중 드라마 2026 화제 장면 시청률' },
  { id: 'ent-002', category: '연예계', label: '주말 드라마 최신 줄거리', query: '주말드라마 최신화 줄거리 예고 시청률' },
  { id: 'ent-003', category: '연예계', label: '넷플릭스 신작 드라마', query: '넷플릭스 드라마 신작 2026 공개' },
  { id: 'ent-004', category: '연예계', label: '월화 드라마 화제', query: '월화드라마 2026 방영 화제 출연진' },
  { id: 'ent-005', category: '연예계', label: '수목 드라마 줄거리 반응', query: '수목드라마 2026 최신 화제 반응' },
  { id: 'ent-006', category: '연예계', label: '예능 최신화 화제 장면', query: '예능 프로그램 최신화 2026 화제 클립 출연진' },
  { id: 'ent-007', category: '연예계', label: '주말 예능 시청률 화제', query: '주말예능 시청률 화제 장면 2026' },
  { id: 'ent-008', category: '연예계', label: '드라마 OST 화제', query: '드라마 OST 2026 음원차트 화제' },
  { id: 'ent-009', category: '연예계', label: 'OTT 드라마 공개 순위', query: '넷플릭스 왓챠 티빙 드라마 2026 순위 화제' },
  { id: 'ent-010', category: '연예계', label: '예능 신규 출연진 화제', query: '예능 새 시즌 출연진 2026 화제' },
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

// 카테고리에서 아직 안 쓴 주제 랜덤 선택
function pickUnusedTopic(category) {
  const used = getUsedTopicIds();
  // 카테고리 매칭: '부동산', '부동산_전세' 둘 다 → category '부동산' 매칭
  const base = category.split('_')[0];
  const pool = TOPIC_POOL.filter(t => t.category === base || t.category === category);
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
    '복지정책': '복지 정책 지원',
    '세금': '세금 절세',
    '금융': '금융 재테크',
    '연예계': '연예계 연예인 이슈',
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
3. 확인되지 않은 내용은 "~로 알려졌다", "~라는 보도가 있다" 등 유보적 표현 사용.
4. 한국어로만 작성. 외국어(일본어/중국어/영어) 절대 금지.
5. "알아보겠습니다", "살펴보겠습니다" 문장 시작 금지. 바로 핵심 내용으로 시작.
6. 각 섹션은 400자 이상의 구체적 내용 (단순 나열이 아닌 깊이 있는 서술).
7. heroStats는 작품명, 방송사/OTT, 시청률 또는 화제 장면으로 구성.

유효한 JSON만 응답 (코드블록/마크다운 없이):
{
  "title": "연예 이슈 중심의 SEO 제목 (45-65자, 인물명/작품명 포함)",
  "description": "독자의 호기심을 자극하는 메타 설명 (80-120자)",
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
  "summary": ["🎬 핵심 이슈: 확인된 사실 요약", "💬 반응: 보도된 팬/대중 반응", "📅 다음: 공식 확인된 일정/포인트"],
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

  const prompt = `You are a professional Korean economic blogger with 10 years of experience. Write a detailed, data-rich blog post in KOREAN ONLY.

Date: ${today}
Category: ${base}
Topic (MUST write about THIS specific subject — based on TODAY's real news): ${chosenTopic.topic}

TODAY's real news headlines (use these as factual backbone — cite actual figures):
${newsContext}

STRICT RULES — VIOLATIONS WILL MAKE THE ARTICLE USELESS:
1. Write ONLY in Korean (한국어만 사용). ZERO foreign words — no Japanese (hiragana あいうえお, katakana アイウエオ, kanji 比べて), no Chinese characters, no English words, no Vietnamese (quyết, của, đã 등 절대 금지), no French, no any other language. Every single word must be pure Korean. If you need "compared to" → "대비" or "에 비해". Use "있음/없음" instead of ○/×.
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

  let data = JSON.parse(jsonMatch[0]);
  data = sanitizeReviewData(data); // 뉴스에도 외국어 제거 적용
  data.category = base;
  data.date = today;

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
1. 순수 한국어만 사용. 중국어(한자), 일본어(히라가나/가타카나) 절대 금지.
2. 영어 단어를 한국어 문장 중간에 절대 삽입 금지. "Narrow한", "recently", "Best", "Review" 같은 영단어 절대 금지. 반드시 "좁은 공간", "최근", "최고", "리뷰" 등 한국어로 대체.
3. "あり" "なし" "ある" "ない" 같은 일본어 절대 금지.
4. "们" "經" "験" 같은 중국 한자 절대 금지.
5. "알아보겠습니다" "살펴보겠습니다" "한 달 사용해봤습니다" "직접 사용해봤습니다" 금지.
6. "한 달 사용", "한달 후기", "실사용 후기", "직접 써봤습니다" 같은 표현 절대 금지. 제품 소개글·홍보글 스타일로 작성.
7. 비교표의 ○/× 대신 반드시 "있음"/"없음" 또는 구체적 한국어 값 사용.
8. 반드시 valid JSON으로만 응답.`;

  const productDesc = info.bodyText?.substring(0, 1500) || info.description || '';

  const prompt = `다음 제품의 구매 유도 리뷰를 작성하고 JSON으로 반환하세요.

제품명: ${info.title}
${finalPrice ? `가격: ${finalPrice}` : ''}
제품 설명: ${productDesc || '없음 (제품명 기반으로 창의적으로 작성)'}

===아래 JSON을 완성하세요. 각 섹션 content는 반드시 600자 이상 한국어로 빽빽하게 채우세요. 절대 짧게 쓰지 마세요.===

{
  "title": "제품별 SEO 최적화 제목 (50-65자). 매번 다른 패턴 사용. '한 달', '직접 사용', '실사용', '써봤습니다' 패턴 절대 금지. 예시 패턴: '[제품명] 이게 왜 인기인지 이제 알겠다', '[제품명] — 이 가격에 이 퀄리티 가능한 이유', '요즘 이 제품 왜 다들 사는지 이유 있었다 — [제품명]', '[제품명] 선물로 이게 정답인 이유', '[제품명] 완전 정복 — 스펙·가격·추천 대상 총정리', '지금 가장 핫한 [제품명] 구매 가이드'.",
  "productName": "${info.title}",
  "description": "90-120자 메타 설명. 구매 욕구 자극.",
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
      "content": "[대화형 문체로 작성. 600자 이상 필수. <p>추천 대상 설명 3줄</p><ul><li>추천 상황1 — 구체적 이유</li><li>추천 상황2 — 구체적 이유</li><li>추천 상황3 — 구체적 이유</li></ul><p>비추천 대상도 솔직하게</p><blockquote>최종 추천 한 줄</blockquote> 구조로 작성]"
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

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js"></script>
  <title>${escHtml(data.title)} - 나만 모르는 요즘 소식</title>
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
    "author": { "@type": "Person", "name": "나만 모르는 요즘 소식" },
    "publisher": { "@type": "Organization", "name": "나만 모르는 요즘 소식" }
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

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js"></script>
  <title>${escHtml(data.title)} - 나만 모르는 요즘 소식</title>
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
    "author": { "@type": "Person", "name": "나만 모르는 요즘 소식" },
    "reviewRating": { "@type": "Rating", "ratingValue": "${data.rating || 4}", "bestRating": "5" }
  }
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

    <!-- 해시태그 -->
    <div class="mt-8 flex flex-wrap gap-2">
      ${(data.hashtags || data.keywords || []).map(k => `<span class="text-xs text-ink-500 bg-ink-100 px-2.5 py-1 rounded-full">#${escHtml(k.replace(/\s+/g, '').replace(/^#/, ''))}</span>`).join('\n      ')}
    </div>

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
  '연예계':  { emoji: '🎬', tagColor: '#f472b6', tagBg: 'rgba(244,114,182,0.15)', cardBg: 'linear-gradient(135deg,#4a044e,#86198f)' },
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
      <article class="post-item post-card rounded-2xl border border-ink-100 overflow-hidden bg-white shadow-card cursor-pointer"
               data-category="${escAttr(data.category)}" data-title="${escAttr(data.title)}"
               onclick="location.href='posts/${data.slug}.html'">
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

function getKSTDateTime() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().split('T')[0];
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${date}-${hour}${min}`;
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
