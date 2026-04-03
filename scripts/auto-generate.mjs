import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// 환경 변수 (GitHub Secrets)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

/**
 * [프롬프트] 정보공유 스타일 + 카드뉴스 가이드
 */
const SYSTEM_MSG = `
# Role: 대한민국 상위 1% 수익형 블로그 에디터 및 비주얼 디자이너
# Objective: "정보공유 스타일"의 2,000자 포스팅과 SVG 카드뉴스 8장 생성

## [서술 가이드라인]
1. 도입부(스토리텔링): 반드시 필자의 개인적인 생활 고민(가족 이야기, 가계부, 물가 체감 등)을 3문단 이상 상세히 작성.
2. 말투: '~하더라고요', '~인 셈이죠' 등 친근한 구어체 사용.
3. 수익화: 본문 중간에 "가전 지원금 혜택 보시고 LG Objet 같은 프리미엄 가전 구매 계획도 세워보세요" 문구 삽입.

## [SVG 카드뉴스 디자인]
- 규격: 1080x1350px 세로형, 배경(#1A2A4A), 텍스트(#FFFFFF), 포인트(#F5A623).
- 구성: 총 8장의 슬라이드를 <svg> 코드로 생성 (표지, 상세정보, 결론 포함).
`;

/**
 * [공통] Groq API 호출 (품질 재시도 로직 포함)
 */
async function callGroqWithRetry(prompt, isNews = true, retryCount = 0) {
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
  const content = JSON.parse(data.choices[0].message.content);

  // 뉴스 모드일 때만 300자 품질 검사 진행
  if (isNews && content.sections && content.sections.some(s => s.content.length < 300) && retryCount < 1) {
    console.warn(`⚠️ 품질 보완 재작성 중...`);
    return callGroqWithRetry(prompt + "\n\n이전 내용이 너무 짧습니다. 각 섹션을 400자 이상으로 훨씬 길게 작성하세요.", isNews, retryCount + 1);
  }
  return content;
}

/**
 * [뉴스 모드] 실시간 이슈 수집 및 HTML 빌드
 */
async function fetchNewsData(category) {
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
}

function buildNewsHTML(data) {
  let html = `<div class="post-content">`;
  data.sections.forEach((s, idx) => {
    html += `<h2>${s.title}</h2><p>${s.content}</p>`;
    const c1 = data.cardNews?.[idx * 2];
    const c2 = data.cardNews?.[idx * 2 + 1];
    if (c1) html += `<div class="svg-card">${c1.svgCode}</div>`;
    if (c2) html += `<div class="svg-card">${c2.svgCode}</div>`;
  });
  html += `</div>`;
  return html;
}

/**
 * [제품 리뷰 모드] 기존 로직 복구 (원본 코드 반영)
 */
async function generateProductReview(affiliateUrl, platform, scrapeUrl, manualName, manualPrice, manualImages) {
  console.log(`\n📦 [${manualName || '제품'}] 리뷰 생성 시작...`);
  const prompt = `
    다음 제품에 대한 블로그 리뷰를 JSON으로 작성해줘.
    - 제품명: ${manualName || '자동 분석'}
    - 가격: ${manualPrice || '정보 없음'}
    - 링크: ${affiliateUrl}
    - 플랫폼: ${platform}
    
    구조: { "title", "description", "category": "리뷰", "tags":[], "sections": [{"title", "content"}], "pros":[], "cons":[] }
  `;
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
 * [공통] 파일 저장 로직
 */
function savePost(data, html) {
  const dateStr = new Date().toISOString().split('T')[0];
  const slug = data.title.replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
  const dir = path.join(ROOT, 'posts', data.category || '일반');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = `---\nlayout: post\ntitle: "${data.title}"\ncategory: "${data.category}"\n---\n${html}`;
  writeFileSync(path.join(dir, `${dateStr}-${slug}.html`), content);
}

/**
 * [실행] 메인 함수
 */
async function run() {
  const mode = process.argv[2] || 'news';
  console.log(`🚀 실행 모드: ${mode}`);

  if (mode === 'news') {
    for (let i = 0; i < 2; i++) {
      const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
      const topic = await fetchNewsData(category);
      if (!topic) continue;
      const result = await callGroqWithRetry(`주제: ${topic.title}\n내용: ${topic.description}\n포스팅 생성해줘.`, true);
      savePost(result, buildNewsHTML(result));
    }
  } else if (mode === 'product_review') {
    const inputPath = path.join(ROOT, 'scripts', 'product_items.txt');
    if (!existsSync(inputPath)) return console.log("❌ product_items.txt 없음");
    
    const lines = readFileSync(inputPath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split('|'); // 기존의 | 구분자 로직 유지
      const affiliateUrl = parts[0]?.trim();
      if (!affiliateUrl) continue;
      
      const data = await generateProductReview(affiliateUrl, 'coupang', null, parts[2], parts[3], []);
      savePost(data, buildProductReviewHTML(data));
      console.log(`✅ 리뷰 완료: ${data.title}`);
    }
  }
}

run();
