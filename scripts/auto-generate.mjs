import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 대한민국 상위 1% 수익형 블로그 에디터
# Task: 반드시 아래 JSON 구조로만 답변하세요. (설명이나 인사말 금지)
{
  "title": "글 제목",
  "category": "경제",
  "sections": [
    { "title": "소제목", "content": "400자 이상의 상세 본문" }
  ],
  "cardNews": [
    { "svgCode": "<svg>...</svg>" }
  ]
}
# 지침: 도입부는 필자의 가계부 고민 등 일상 서사로 시작할 것.
`;

/**
 * [수정] choices[0] 에러 방지용 안전 호출 함수
 */
async function callGroqSafe(prompt, retry = 0) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${GROQ_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: SYSTEM_MSG },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 8000,
                temperature: 0.5,
                response_format: { type: "json_object" }
            }),
        });

        const data = await res.json();

        // [핵심] API 응답 구조 검증: choices가 없으면 에러로 간주
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("❌ API 응답 오류 데이터:", JSON.stringify(data));
            throw new Error("API_INVALID_RESPONSE");
        }

        const content = JSON.parse(data.choices[0].message.content);
        
        // 데이터 유효성 검사
        if (!content.sections || !Array.isArray(content.sections)) {
            throw new Error("INVALID_CONTENT_STRUCTURE");
        }

        return content;
    } catch (e) {
        console.log(`🔄 재시도 중... (${retry + 1}/3) 사유: ${e.message}`);
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
        
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        return {
            title: titleMatch ? titleMatch[1].replace(/ - .*$/, '') : category,
            description: "실시간 뉴스 기반 분석"
        };
    } catch (e) { return null; }
}

function savePost(data, cat) {
    const dateStr = new Date().toISOString().split('T')[0];
    const safeTitle = String(data.title || 'post').replace(/[^\w\s가-힣]/g, '').replace(/\s+/g, '-').slice(0, 30);
    const dir = path.join(ROOT, 'posts', cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let body = `<div class="post-content">`;
    if (data.sections) {
        data.sections.forEach((s, idx) => {
            body += `<h2>${s.title}</h2><p>${s.content}</p>`;
            // 카드뉴스를 본문 중간에 삽입
            const svg = data.cardNews?.[idx]?.svgCode;
            if (svg) body += `<div class="svg-container" style="margin:30px 0; text-align:center;">${svg}</div>`;
        });
    }
    body += `</div>`;

    const content = `---\nlayout: post\ntitle: "${data.title}"\ncategory: "${cat}"\ndate: ${dateStr}\n---\n${body}`;
    writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), content);
}

async function run() {
    console.log("🚀 bloginfo360 엔진 가동 중...");
    
    // 환경변수 체크
    if (!GROQ_API_KEY) {
        console.error("❌ GROQ_API_KEY가 설정되지 않았습니다.");
        return;
    }

    for (let i = 0; i < 2; i++) {
        const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const topic = await fetchNews(cat);
        
        if (!topic) {
            console.log(`⚠️ ${cat} 카테고리 뉴스 없음, 건너뜁니다.`);
            continue;
        }

        try {
            const res = await callGroqSafe(`주제: ${topic.title} 이슈 분석 포스팅 작성`);
            savePost(res, cat);
            console.log(`✅ 발행 완료: ${res.title}`);
        } catch (e) {
            console.error(`❌ ${cat} 발행 실패: ${e.message}`);
        }
    }
    console.log("📝 작업 종료");
}

run();
