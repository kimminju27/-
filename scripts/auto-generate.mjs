import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 전문 블로그 에디터 및 SVG 디자이너
# Task: 반드시 다음 JSON 구조로만 답변하세요.
{
  "title": "제목",
  "description": "요약",
  "category": "카테고리",
  "tags": ["태그1", "태그2"],
  "sections": [
    { "title": "소제목1", "content": "400자 이상의 상세내용" },
    { "title": "소제목2", "content": "400자 이상의 상세내용" },
    { "title": "소제목3", "content": "400자 이상의 상세내용" }
  ],
  "cardNews": [
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" },
    { "svgCode": "<svg>...</svg>" }
  ]
}
# 스타일: 도입부는 필자의 가계부 고민 등 일상 서사로 시작할 것.
`;

async function callGroqSafe(prompt, retry = 0) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
                max_tokens: 12000,
                temperature: 0.6,
                response_format: { type: "json_object" }
            }),
        });
        const data = await res.json();
        const content = JSON.parse(data.choices[0].message.content);
        
        // [방어코드] 데이터 누락 시 기본값 채우기
        if (!content.title) content.title = "최신 정보 업데이트";
        if (!content.sections || !Array.isArray(content.sections)) content.sections = [];
        
        return content;
    } catch (e) {
        if (retry < 2) return callGroqSafe(prompt, retry + 1);
        throw e;
    }
}

async function fetchNews(category) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        const xml = await res.text();
        const item = xml.match(/<item>([\s\S]*?)<\/item>/g)?.[0];
        if (!item) return null;
        return {
            title: (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || category).replace(/ - .*$/, ''),
            description: "뉴스 데이터 분석"
        };
    } catch (e) { return null; }
}

function savePost(data, cat) {
    const dateStr = new Date().toISOString().split('T')[0];
    // [오류지점 수정] title이 없을 경우 대비
    const safeTitle = String(data.title || 'post').replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
    const dir = path.join(ROOT, 'posts', cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let body = `<div class="post-content">`;
    // [오류지점 수정] sections가 없을 경우 대비
    if (data.sections && Array.isArray(data.sections)) {
        data.sections.forEach((s, idx) => {
            body += `<h2>${s.title}</h2><p>${s.content}</p>`;
            // 카드뉴스를 섹션 사이에 적절히 분배 (8장 기준)
            const c1 = data.cardNews?.[idx * 2];
            const c2 = data.cardNews?.[idx * 2 + 1];
            if (c1) body += `<div class="card-news">${c1.svgCode}</div>`;
            if (c2) body += `<div class="card-news">${c2.svgCode}</div>`;
        });
    }
    body += `</div>`;

    const content = `---\nlayout: post\ntitle: "${data.title}"\ncategory: "${cat}"\ndate: ${dateStr}\n---\n${body}`;
    writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), content);
}

async function run() {
    console.log("🚀 bloginfo360 엔진 가동 중...");
    for (let i = 0; i < 2; i++) {
        const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const topic = await fetchNews(cat);
        if (!topic) continue;

        try {
            const res = await callGroqSafe(`주제: ${topic.title} 이슈를 바탕으로 정보공유형 포스팅과 카드뉴스 8장을 만들어줘.`);
            savePost(res, cat);
            console.log(`✅ 발행 성공: ${res.title}`);
        } catch (e) {
            console.error(`❌ 에러 발생: ${e.message}`);
        }
    }
    console.log("📝 모든 작업 및 사이트 갱신 완료");
}

run();
