import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 블로그 에디터 (JSON 응답 필수)
반드시 다음 구조로 답하세요:
{
  "title": "제목",
  "content": "본문 HTML (h2, p 태그 포함 2000자 이상)",
  "category": "카테고리"
}
`;

/**
 * AI 호출 (모델을 llama-3.1-8b-instant로 변경하여 한도 에러 방지)
 */
async function callGroqSafe(prompt) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant', 
            messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
            response_format: { type: "json_object" }
        }),
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

/**
 * [중요] 사이트 메인(index.html) 및 목록 자동 갱신
 * 이 함수가 있어야 사이트 첫 화면에 글이 뜹니다.
 */
function updateIndexAndSitemap() {
    console.log("🔄 사이트 목록 업데이트 중...");
    const postsDir = path.join(ROOT, 'posts');
    let postList = [];

    CATEGORIES.forEach(cat => {
        const dir = path.join(postsDir, cat);
        if (existsSync(dir)) {
            const files = readdirSync(dir).filter(f => f.endsWith('.html'));
            files.forEach(file => {
                const content = readFileSync(path.join(dir, file), 'utf-8');
                const titleMatch = content.match(/title: "(.*?)"/);
                postList.push({
                    title: titleMatch ? titleMatch[1] : file,
                    path: `posts/${cat}/${file}`,
                    date: file.substring(0, 10)
                });
            });
        }
    });

    // 최신순 정렬
    postList.sort((a, b) => b.date.localeCompare(a.date));

    // 간단한 index.html 생성 (메인 화면)
    const indexHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>bloginfo360</title></head>
    <body><h1>최신 포스팅</h1><ul>
    ${postList.map(p => `<li>[${p.date}] <a href="${p.path}">${p.title}</a></li>`).join('')}
    </ul></body></html>`;
    
    writeFileSync(path.join(ROOT, 'index.html'), indexHTML);
}

async function run() {
    console.log("🚀 bloginfo360 가동");
    const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    
    try {
        const topicPrompt = `${cat} 카테고리의 최신 이슈로 블로그 글 써줘.`;
        const res = await callGroqSafe(topicPrompt);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const safeTitle = Math.random().toString(36).substring(7);
        const dir = path.join(ROOT, 'posts', cat);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const finalFile = `---\nlayout: post\ntitle: "${res.title}"\n---\n${res.content}`;
        writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), finalFile);
        
        console.log(`✅ 파일 생성 완료: ${res.title}`);
        
        // 목록 갱신 실행
        updateIndexAndSitemap();
        
    } catch (e) {
        console.error("❌ 에러:", e.message);
    }
}

run();
