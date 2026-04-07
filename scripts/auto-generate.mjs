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

// ─── Groq API ─────────────────────────────────────────────────
async function callGroq(prompt, retryCount = 0) {
  const systemMsg = `당신은 대한민국 최고의 SEO 정보 블로그 작가입니다. 반드시 아래 JSON 형식으로만 응답하세요.

[언어 규칙 — 절대 준수]
- 오직 한국어(한글)와 영어만 사용
- 한자(漢字) 절대 금지: 民間→민간, 供給→공급, 不動産→부동산
- 독일어 절대 금지: unterschied, jedoch, daher, während, nemli, voilà 등
- 모든 비한글·비영어 문자 금지 — 위반 시 재생성됩니다

[글쓰기 규칙]
- "~에 대해 알아보겠습니다" 금지 → 바로 본론 시작
- "중요합니다" 단순 반복 금지 → 구체적 수치/날짜로 설명
- "첫째, 둘째, 셋째" 나열 최소화 → 자연스러운 구어체로
- 모든 수치는 실제 한국 공식 자료 기반으로 작성
- 독자가 "오늘 당장 쓸 수 있는" 실용 정보 위주

{
  "title": "글 제목 (50자 이내, 연도+키워드+숫자/혜택 포함, 클릭 유발)",
  "description": "메타 설명 (80-120자, 핵심 키워드+수치 포함)",
  "category": "카테고리명",
  "slug": "korean-topic-english-slug",
  "hashtags": ["#키워드1", "#키워드2", "#키워드3", "#키워드4", "#키워드5", "#키워드6", "#키워드7", "#키워드8", "#키워드9", "#키워드10", "#키워드11", "#키워드12"],
  "keyPoints": [
    "핵심 포인트 1 — 구체적 숫자나 날짜 반드시 포함",
    "핵심 포인트 2 — 독자의 가장 큰 궁금증 해소",
    "핵심 포인트 3 — 실행 가능한 정보로 마무리"
  ],
  "stats": [
    {"label": "통계 항목명", "value": "숫자/금액", "unit": "단위(원/%)"},
    {"label": "통계 항목명", "value": "숫자/금액", "unit": "단위"},
    {"label": "통계 항목명", "value": "숫자/금액", "unit": "단위"},
    {"label": "통계 항목명", "value": "숫자/금액", "unit": "단위"}
  ],
  "imageCards": [
    {"icon":"📊","title":"제목","type":"stat","items":["항목1","항목2","항목3"]},
    {"icon":"📋","title":"제목","type":"checklist","items":["항목1","항목2","항목3","항목4"]},
    {"icon":"🔄","title":"제목","type":"process","items":["1단계","2단계","3단계","4단계"]},
    {"icon":"⚖️","title":"제목","type":"comparison","items":["비교1","비교2","비교3"]},
    {"icon":"💡","title":"제목","type":"tips","items":["팁1","팁2","팁3","팁4"]}
  ],
  "intro": "도입부 — 독자의 실생활과 연결되는 구체적 상황 묘사로 시작. 수치/날짜 포함. 3문단 이상, 600자 이상.",
  "sections": [
    {"id":"section1","title":"소제목1(숫자포함)","content":"700자이상.공식수치·날짜인용.구어체.","tip":"핵심팁","highlight":"강조수치"},
    {"id":"section2","title":"소제목2","content":"700자이상.단계별설명.","tip":"주의사항","highlight":"기관명"},
    {"id":"section3","title":"소제목3","content":"700자이상.금액/조건/비교.","tip":"혜택방법","highlight":"핵심금액"},
    {"id":"section4","title":"소제목4-총정리","content":"700자이상.주의사항·행동유도.","tip":"첫행동","highlight":"정리문구"}
  ],
  "comparisonTable": {
    "caption":"비교표제목",
    "headers":["구분","항목A","항목B"],
    "rows":[["비교1","내용","내용"],["비교2","내용","내용"],["비교3","내용","내용"]]
  },
  "faqs": [
    {"question":"질문1","answer":"150자이상답변"},
    {"question":"질문2","answer":"150자이상답변"},
    {"question":"질문3","answer":"150자이상답변"}
  ],
  "sources": [
    {"name":"언론사A — 기사제목(2026.MM)","url":"REPLACE_WITH_REAL_URL"},
    {"name":"언론사B — 기사제목(2026.MM)","url":"REPLACE_WITH_REAL_URL"},
    {"name":"언론사C — 기사제목(2026.MM)","url":"REPLACE_WITH_REAL_URL"}
  ]
}

[필수 규칙]
- hashtags: 반드시 12개 이상, #으로 시작, 구글/네이버 검색 최적화
- imageCards: 반드시 5개, 각기 다른 type 사용
- sections: 반드시 4개, 각 content 700자 이상
- sources: 반드시 3개, 서로 다른 언론사/기관`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt }
      ],
      max_tokens: 7000,
      temperature: 0.7,
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
    // 429 Rate limit — 에러 메시지에서 대기 시간 파싱 후 재시도
    if (res.status === 429 && retryCount < 2) {
      const waitMatch = errText.match(/try again in ([\d.]+)s/);
      const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 2000 : 40000;
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
  if (!Array.isArray(content.sections) || content.sections.length < 2) {
    if (retryCount < 2) {
      console.warn(`⚠️ sections 부족 (${content.sections?.length || 0}개), 35초 대기 후 재시도...`);
      await new Promise(r => setTimeout(r, 36000));
      return callGroq(prompt + '\n\n[필수] sections 배열 4개를 반드시 포함하고 각 content는 700자 이상으로 작성하세요!', retryCount + 1);
    }
    throw new Error('sections 배열이 없거나 부족합니다.');
  }

  // 내용 길이 검증
  const shortSection = content.sections.some(s => (s.content || '').length < 200);
  if (shortSection && retryCount < 1) {
    console.warn(`⚠️ 섹션 내용 너무 짧음, 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + '\n\n[필수] 각 섹션 content는 반드시 700자 이상 작성하세요!', retryCount + 1);
  }

  // 외국어 혼입 검증
  const allText = (content.sections || []).map(s => s.content || '').join(' ') + (content.intro || '');
  if (hasForEignLanguage(allText) && retryCount < 1) {
    console.warn(`⚠️ 외국어 감지, 35초 대기 후 재시도...`);
    await new Promise(r => setTimeout(r, 36000));
    return callGroq(prompt + '\n\n[경고] 외국어(독일어·한자 등) 감지됨. 오직 한국어와 영어만 사용하세요!', retryCount + 1);
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
    stat:       { bg: 'from-blue-500 to-blue-700',    light: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
    checklist:  { bg: 'from-green-500 to-green-700',  light: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
    process:    { bg: 'from-purple-500 to-purple-700',light: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    comparison: { bg: 'from-orange-500 to-orange-600',light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    tips:       { bg: 'from-teal-500 to-teal-700',    light: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200' },
    summary:    { bg: 'from-rose-500 to-rose-700',    light: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200' },
  };
  const cardHTML = cards.slice(0, 5).map(card => {
    const c = colorMap[card.type] || colorMap.tips;
    const items = (card.items || []).map((item, i) => {
      if (card.type === 'process') return `<div class="flex items-start gap-2"><span class="w-5 h-5 rounded-full bg-gradient-to-br ${c.bg} text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">${i+1}</span><span class="text-xs ${c.text} leading-relaxed">${item}</span></div>`;
      if (card.type === 'checklist') return `<div class="flex items-start gap-2"><span class="text-xs font-black ${c.text} shrink-0 mt-0.5">✓</span><span class="text-xs ${c.text} leading-relaxed">${item}</span></div>`;
      return `<div class="text-xs ${c.text} leading-relaxed border-b ${c.border} pb-1.5 last:border-0 last:pb-0">${item}</div>`;
    }).join('');
    return `
      <div class="${c.light} border ${c.border} rounded-2xl overflow-hidden shadow-sm">
        <div class="bg-gradient-to-r ${c.bg} px-4 py-3 flex items-center gap-2">
          <span class="text-lg">${card.icon || '📌'}</span>
          <p class="text-white font-bold text-sm leading-tight">${card.title}</p>
        </div>
        <div class="p-4 space-y-2">${items}</div>
      </div>`;
  }).join('');
  return `
    <div class="not-prose my-10">
      <p class="text-xs font-bold text-ink-400 uppercase tracking-widest mb-4">🖼️ 핵심 인포그래픽</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${cardHTML}
      </div>
    </div>`;
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
      .map(p => `<p>${p.trim()}</p>`)
      .join('\n          ');

    const tipBox       = s.tip       ? buildHighlightBox(s.tip,       idx % 2 === 0 ? 'tip' : 'point') : '';
    const highlightBox = s.highlight ? buildHighlightBox(s.highlight, 'info')  : '';
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
        ${midAd}
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
    `<a href="../index.html" class="text-xs text-ink-500 bg-ink-100 hover:bg-brand-100 hover:text-brand-700 px-2.5 py-1 rounded-full transition-colors">${t.startsWith('#') ? t : '#'+t}</a>`
  ).join('\n          ');

  const sourcesHTML = (data.sources || [{ name: '공식 자료 기반 작성', url: '#' }]).map(s =>
    `<li class="text-xs text-ink-500 flex items-start gap-1.5">
              <span class="text-ink-300 shrink-0">•</span>
              <a href="${s.url}" target="_blank" rel="noopener" class="hover:text-brand-600 transition-colors underline decoration-dotted">${s.name}</a>
            </li>`).join('\n          ');

  const introParagraphs = (data.intro || '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(p => `<p>${p.trim()}</p>`)
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
  <meta property="og:image" content="https://bloginfo360.com${meta.ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:published_time" content="${isoDate}">
  <meta property="article:modified_time" content="${isoDate}">
  <meta property="article:section" content="${data.category}">
  <meta property="article:author" content="김민주">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${data.title}">
  <meta name="twitter:description" content="${data.description}">
  <meta name="twitter:image" content="https://bloginfo360.com${meta.ogImage}">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"${data.title}","description":"${data.description}","datePublished":"${dateStr}","dateModified":"${dateStr}","author":{"@type":"Person","name":"김민주","url":"https://bloginfo360.com/about"},"publisher":{"@type":"Organization","name":"나만 모르는 요즘 소식","url":"https://bloginfo360.com"},"mainEntityOfPage":{"@type":"WebPage","@id":"${postUrl}"},"image":"https://bloginfo360.com${meta.ogImage}","inLanguage":"ko-KR"}
  </script>
  ${faqJsonLD.length > 0 ? `<script type="application/ld+json">
  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":${JSON.stringify(faqJsonLD)}}
  </script>` : ''}
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"홈","item":"https://bloginfo360.com/"},{"@type":"ListItem","position":2,"name":"${data.category}","item":"https://bloginfo360.com/#category"},{"@type":"ListItem","position":3,"name":"${data.title}","item":"${postUrl}"}]}
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
      <a href="../index.html#category" class="hover:text-brand-600 transition-colors">${data.category}</a>
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

        <!-- 히어로 배너 (이미지 대체) -->
        <div class="w-full h-56 sm:h-72 bg-gradient-to-br ${meta.gradient} rounded-2xl flex flex-col items-center justify-center mb-8 relative overflow-hidden border border-ink-100" role="img" aria-label="${data.title}">
          <div class="absolute inset-0 opacity-[0.04] bg-[radial-gradient(circle_at_30%_50%,#000_1px,transparent_1px)] bg-[length:24px_24px]"></div>
          <div class="absolute top-4 right-4 text-xs font-bold px-2.5 py-1 rounded-full ${meta.badge} opacity-80">${data.category}</div>
          <div class="text-7xl mb-4 relative drop-shadow-sm">${meta.emoji}</div>
          <p class="relative text-sm font-bold text-ink-700 px-6 text-center max-w-sm leading-relaxed">${data.title}</p>
          <p class="relative text-xs text-ink-400 mt-2">${dateFormatted}</p>
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
          <div class="w-full h-44 bg-gradient-to-br ${meta.gradient} flex flex-col items-center justify-center relative overflow-hidden px-4">
            <div class="absolute inset-0 opacity-[0.04] bg-[radial-gradient(circle_at_30%_50%,#000_1px,transparent_1px)] bg-[length:20px_20px]"></div>
            <span class="relative text-4xl mb-1">${meta.emoji}</span>
            ${firstStat ? `<span class="relative text-lg font-black" style="color:${meta.color}">${firstStat}</span>` : ''}
            <p class="relative text-center text-xs font-bold text-ink-700 mt-1 line-clamp-2 max-w-[180px] leading-tight">${data.title.slice(0, 28)}${data.title.length > 28 ? '…' : ''}</p>
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
          ? newsCtx.all.slice(0, 5).map((n, i) => `[뉴스${i+1}] ${n.title} (출처: ${n.source || '언론'})`).join('\n')
          : '';

        const prompt = newsCtx
          ? `카테고리: ${category}

[오늘의 실제 뉴스 — 아래 내용을 반드시 참고해서 작성]
${newsContext}

위 실제 뉴스를 바탕으로 "${category}" 카테고리의 정보성 블로그 포스팅을 작성하세요.
- 뉴스에 나온 실제 수치·날짜·기관명을 글에 반영할 것
- 각 섹션 700자 이상, 도입부 600자 이상
- hashtags 12개 이상 (#으로 시작, 구글/네이버 SEO 최적화)
- imageCards 5개 (stat, checklist, process, comparison, tips 각 1개씩)
- sources는 서로 다른 언론사 3개 (URL은 "REPLACE_WITH_REAL_URL"로 설정)`
          : `카테고리: ${category}

"${category}" 주제로 2026년 한국 독자에게 유용한 정보성 블로그 포스팅을 작성하세요.
- 실제 한국 정책·제도·수치 기반 작성
- 각 섹션 700자 이상, 도입부 600자 이상
- hashtags 12개 이상 (#으로 시작, 구글/네이버 SEO 최적화)
- imageCards 5개 (stat, checklist, process, comparison, tips 각 1개씩)`;

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
