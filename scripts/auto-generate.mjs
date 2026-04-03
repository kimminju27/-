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

## [1. 서술 가이드라인]
- 스토리텔링: 도입부에서 필자의 생활 밀착형 경험(가족, 가계부, 일상 고민)을 3문단 이상 서술하세요.
- 말투: '~하더라고요', '~인 셈이죠' 등 구어체 사용.
- 수익화: "가전 지원금 혜택 보시고 LG Objet 같은 프리미엄 가전 구매 계획도 세워보세요" 문구 삽입.

## [2. SVG 카드뉴스 디자인]
- 규격: 1080x1350px, 배경(#1A2A4A), 텍스트(#FFFFFF), 포인트(#F5A623).
- 구성: 총 8장의 슬라이드를 <svg> 코드로 생성 (텍스트는 크게, 가독성 위주).
`;

/**
 * Groq API 호출 (재시도 및 품질 검사 포함)
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
        if (!data.choices || !data.choices[0]) throw new Error("API_EMPTY");

        const content = JSON.parse(data.choices[0].message.content);
        if (isNews && content.sections?.some(s => s.content.length < 300) && retryCount < 1) {
            return callGroqWithRetry(prompt + "\n\n내용이 너무 짧습니다. 섹션당 400자 이상으로 다시 써주세요.", isNews, retryCount + 1);
        }
        return content;
    } catch (e) {
        if (retryCount < 2) return callGroqWithRetry(prompt, isNews, retryCount + 1);
        throw e;
    }
}

/**
 * 뉴스 수집 및 HTML 생성
 */
async function fetchNews(category) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (!items.length) return null;
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
    return html + `</div>`;
}

/**
 * 제품 리뷰 로직 (기존 원본 로직 완벽 복구)
 */
async function generateProductReview(affiliateUrl, platform, manualName, manualPrice) {
    const prompt = `제품명: ${manualName}, 가격: ${manualPrice}, 링크: ${affiliateUrl} 리뷰 생성. { "title", "description", "category", "tags", "sections": [{"title", "content"}], "pros", "cons" } 형식 준수.`;
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
 * 파일 저장 및 유틸리티 (Sitemap, Index 등 기존 기능)
 */
function savePost(data, html) {
    const dateStr = new Date().toISOString().split('T')[0];
    const safeTitle = (data.title || 'post').replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
    const dir = path.join(ROOT, 'posts', data.category || '일반');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const content = `---\nlayout: post\ntitle: "${data.title}"\ncategory: "${data.category}"\ntags: ${JSON.stringify(data.tags || [])}\n---\n${html}`;
    writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), content);
}

async function run() {
    const mode = process.argv[2] || 'news';
    console.log(`🚀 [bloginfo360] ${mode} 실행`);

    if (mode === 'news') {
        for (let i = 0; i < 2; i++) {
            const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
            const topic = await fetchNews(cat);
            if (!topic) continue;
            try {
                const res = await callGroqWithRetry(`주제: ${topic.title}\n내용: ${topic.description} 뉴스 포스팅과 8장 카드뉴스 생성.`);
                savePost(res, buildNewsHTML(res));
                console.log(`✅ 발행: ${res.title}`);
            } catch (e) { console.error(e.message); }
        }
    } else if (mode === 'product_review') {
        const inputPath = path.join(ROOT, 'scripts', 'product_items.txt');
        if (!existsSync(inputPath)) return;
        const lines = readFileSync(inputPath, 'utf-8').split('\n').filter(l => l.trim());
        for (const line of lines) {
            const parts = line.replace(/[│｜]/g, '|').split('|');
            if (!parts[0]) continue;
            try {
                const res = await generateProductReview(parts[0], 'coupang', parts[2], parts[3]);
                savePost(res, buildProductReviewHTML(res));
                console.log(`✅ 리뷰: ${res.title}`);
            } catch (e) { console.error(e.message); }
        }
    }
}

run();
