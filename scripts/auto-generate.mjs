import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 대한민국 경제/생활 밀착형 전문 블로그 에디터
# Objective: "정보공유 스타일"의 고품질 포스팅과 SVG 카드뉴스 생성

## [필수 지침]
1. 도입부: 가계부 고민, 고물가 체감 등 개인적 서사를 3문단 이상 상세히 작성 (공감 유도).
2. 팩트 체크: 반드시 실제 한국 법규와 경제 상식에 기반하여 작성 (지어낸 정보 금지).
3. 수익화: "LG Objet 가전 지원금 혜택" 등의 문구를 문맥에 맞게 자연스럽게 삽입.
4. 디자인: 섹션 사이에 1080x1350px SVG 카드뉴스 코드를 포함.

## [JSON 포맷]
{
  "title": "제목",
  "category": "카테고리",
  "sections": [{ "title": "소제목", "content": "400자 이상의 상세내용" }],
  "cardNews": [{ "svgCode": "<svg>...</svg>" }]
}
`;

async function callGroqSafe(prompt, retry = 0) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', // 가장 똑똑한 모델로 복구
                messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
                max_tokens: 6000,
                temperature: 0.5,
                response_format: { type: "json_object" }
            }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return JSON.parse(data.choices[0].message.content);
    } catch (e) {
        if (retry < 1) return callGroqSafe(prompt, retry + 1);
        throw e;
    }
}

async function run() {
    console.log("🚀 bloginfo360 정상화 엔진 가동");
    
    // 1. 카테고리 선정 및 뉴스 수집 (생략 - 구글 RSS 로직 유지)
    const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    
    try {
        const res = await callGroqSafe(`${cat} 카테고리의 최신 이슈로 전문적인 블로그 글을 써줘.`);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const safeTitle = Math.random().toString(36).substring(7);
        const dir = path.join(ROOT, 'posts', cat);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        // 본문 조립 (카드뉴스 포함)
        let body = `<div class="post-content">`;
        res.sections.forEach((s, idx) => {
            body += `<h2>${s.title}</h2><p>${s.content}</p>`;
            if (res.cardNews?.[idx]) body += `<div class="svg-card" style="margin:40px 0;">${res.cardNews[idx].svgCode}</div>`;
        });
        body += `</div>`;

        // 지킬(Jekyll) 형식에 맞춘 파일 저장
        const finalFile = `---\nlayout: post\ntitle: "${res.title}"\ndate: ${dateStr}\ncategory: "${cat}"\n---\n${body}`;
        
        writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), finalFile);
        console.log(`✅ 글 생성 완료: ${res.title}`);

    } catch (e) {
        console.error("❌ 에러 발생:", e.message);
    }
}

run();
