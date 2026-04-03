import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 전문 블로그 에디터
# Task: 정보공유 스타일 포스팅 작성
1. 도입부: 가계부 고민, 물가 등 개인적 서사 3문단 필수.
2. 본문: 각 섹션(3개 이상) 400자 이상 상세 서술.
3. 카드뉴스: 핵심 내용을 요약한 SVG 코드 3장 생성 (안정성을 위해 개수 최적화).
4. 형식: 반드시 JSON 포맷으로만 답변.
`;

async function callGroqSafe(prompt, retry = 0) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
                max_tokens: 5000, // 토큰을 줄여서 끊김 방지
                temperature: 0.5, // 일관성 향상
                response_format: { type: 'json_object' }
            }),
        });
        const data = await res.json();
        if (!data.choices?.[0]?.message?.content) throw new Error("API_EMPTY");
        return JSON.parse(data.choices[0].message.content);
    } catch (e) {
        if (retry < 2) {
            console.log(`🔄 재시도 ${retry + 1}/2...`);
            return callGroqSafe(prompt, retry + 1);
        }
        throw e;
    }
}

async function fetchNews(category) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    const item = xml.match(/<item>([\s\S]*?)<\/item>/g)?.[0];
    if (!item) return null;
    return {
        title: item.match(/<title>([\s\S]*?)<\/title>/)[1].replace(/ - .*$/, ''),
        description: "최신 이슈 분석"
    };
}

function savePost(data, cat) {
    const dateStr = new Date().toISOString().split('T')[0];
    const slug = data.title.replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
    const dir = path.join(ROOT, 'posts', cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let body = `<div class="post-content">`;
    data.sections.forEach((s, idx) => {
        body += `<h2>${s.title}</h2><p>${s.content}</p>`;
        if (data.cardNews?.[idx]) {
            body += `<div class="svg-card" style="margin:20px 0;">${data.cardNews[idx].svgCode}</div>`;
        }
    });
    body += `</div>`;

    const content = `---\nlayout: post\ntitle: "${data.title}"\ncategory: "${cat}"\ndate: ${dateStr}\n---\n${body}`;
    writeFileSync(path.join(dir, `${dateStr}-${slug}.html`), content);
}

// 사이트 인덱스 및 기타 메타파일 갱신 로직 (간략화된 형태라도 유지해야 함)
function finalizeSite() {
    console.log("📝 사이트 업데이트 완료 처리 중...");
    // 여기에 기존 소스의 updateIndex, updateSitemap 로직 복구 필요
}

async function run() {
    console.log("🚀 bloginfo360 가동");
    for (let i = 0; i < 2; i++) {
        const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const topic = await fetchNews(cat);
        if (!topic) continue;

        try {
            const res = await callGroqSafe(`주제: ${topic.title}에 대해 정보공유 스타일로 포스팅 작성.`);
            savePost(res, cat);
            console.log(`✅ 성공: ${res.title}`);
        } catch (e) {
            console.error(`❌ 실패: ${e.message}`);
        }
    }
    finalizeSite();
}

run();
