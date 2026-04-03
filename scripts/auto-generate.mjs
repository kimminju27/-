import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 전문 데이터 분석가 및 스토리텔링형 블로그 에디터
# Objective: "정보공유 스타일"의 2,000자 포스팅과 SVG 카드뉴스 8장 생성

## [서술 가이드라인]
1. 도입부: 필자의 개인적 생활 밀착형 경험(가족, 가계부, 물가 등)을 3문단 이상 상세히 작성하세요.
2. 말투: '~하더라고요', '~인 셈이죠' 등 친근한 구어체 사용.
3. 수익화: "가전 지원금 혜택 보시고 LG Objet 같은 프리미엄 가전 구매 계획도 세워보세요" 문구 삽입.

## [SVG 카드뉴스 디자인]
- 규격: 1080x1350px, 배경(#1A2A4A), 텍스트(#FFFFFF), 포인트(#F5A623).
- 구성: 총 8장의 슬라이드를 <svg> 코드로 생성하세요.
`;

/**
 * [수정] 안전한 API 호출 함수 (Error Handling 강화)
 */
async function callGroqWithRetry(prompt, isNews = true, retryCount = 0) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
        max_tokens: 15000,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      }),
    });

    const data = await res.json();
    
    // [핵심] API 응답 구조 검증 (오류 지점 해결)
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("❌ Groq API 응답 구조에 문제가 있습니다:", JSON.stringify(data));
      throw new Error("API_RESPONSE_INVALID");
    }

    const content = JSON.parse(data.choices[0].message.content);

    // 품질 검사 (뉴스 모드 전용)
    if (isNews && content.sections && content.sections.some(s => s.content.length < 300) && retryCount < 1) {
      console.warn(`⚠️ 품질 미달로 재시도 중...`);
      return callGroqWithRetry(prompt + "\n\n이전 내용이 너무 짧습니다. 각 섹션을 훨씬 길게(400자 이상) 작성하세요.", isNews, retryCount + 1);
    }

    return content;
  } catch (err) {
    if (retryCount < 2) {
      console.log(`🔄 연결 오류로 재시도 중... (${retryCount + 1}/2)`);
      return callGroqWithRetry(prompt, isNews, retryCount + 1);
    }
    throw err;
  }
}

/**
 * [뉴스 모드] 실시간 이슈 수집 및 HTML 빌드
 */
async function fetchNewsData(category) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (items.length === 0) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 5))];
    return {
      title: item.match(/<title>([\s\S]*?)<\/title>/)[1].replace(/ - .*$/, ''),
      description: item.match(/<description>([\s\S]*?)<\/description>/)[1]
    };
  } catch (e) { return null; }
}

function buildNewsHTML(data) {
  let html = `<div class="post-content">`;
  data.sections.forEach((s, idx) => {
    html += `<h2>${s.title}</h2><p>${s.content}</p>`;
    const c1 = data.cardNews?.[idx * 2];
    const c2 = data.cardNews?.[idx * 2 + 1];
    if (c1) html += `<div class="svg-card" style="margin:20px 0;">${c1.svgCode}</div>`;
    if (c2) html += `<div class="svg-card" style="margin:20px 0;">${c2.svgCode}</div>`;
  });
  html += `</div>`;
  return html;
}

/**
 * [제품 리뷰 모드] 기존 로직 유지
 */
async function generateProductReview(affiliateUrl, manualName, manualPrice) {
  const prompt = `제품명: ${manualName}, 가격: ${manualPrice}, 링크: ${affiliateUrl}에 대한 리뷰 JSON 생성. "pros", "cons", "sections" 포함 필수.`;
  return await callGroqWithRetry(prompt, false);
}

function buildProductReviewHTML(data) {
  let html = `<h1>${data.title}</h1><p>${data.description}</p>`;
  data.sections.forEach(s => { html += `<h2>${s.title}</h2><p>${s.content}</p>`; });
  html += `<h3>장점</h3><ul>${data.pros.map(p => `<li>${p}</li>`).join('')}</ul>`;
  html += `<h3>단점</h3><ul>${data.cons.map(c => `<li>${c}</li>`).join('')}</ul>`;
  return html;
}

/**
 * [저장] 파일 생성
 */
function savePost(data, html) {
  const dateStr = new Date().toISOString().split('T')[0];
  const safeTitle = (data.title || 'untitled').replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
  const dir = path.join(ROOT, 'posts', data.category || '일반');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = `--
