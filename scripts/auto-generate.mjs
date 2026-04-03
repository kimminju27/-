import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CATEGORIES = ['경제', '세금', '부동산', '복지', '보험', '주식'];

const SYSTEM_MSG = `
# Role: 대한민국 민생 경제 전문 블로그 에디터
# Objective: 실제 한국의 최신 정책과 경제 상식에 기반한 정확한 포스팅 생성

## [글쓰기 지침 - 절대 준수]
1. 도입부: 가계부 고민, 물가 상승 체감 등 '서민의 일상'을 담은 에세이를 3문단 이상 작성하세요.
2. 팩트 우선: 존재하지 않는 제도(예: 신용카드 할부 세금 등)를 절대 지어내지 마세요. 한국 국세청, 보건복지부 공식 발표 기준만 다루세요.
3. 말투: 블로그 독자에게 이야기하듯 친근한 구어체(~하더라고요, ~입니다)를 사용하세요.
4. 수익화: "정부 지원금을 활용해 LG Objet 가전으로 인테리어를 바꿨다"는 식의 언급을 자연스럽게 1회 포함하세요.

## [형식]
- 반드시 JSON 구조로만 출력할 것.
- 카드뉴스는 안정성을 위해 3~4장으로 최적화하여 SVG 코드를 생성할 것.
`;

async function callGroqSafe(prompt, retry = 0) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // 한도가 넉넉한 8b 모델로 변경하여 지금 바로 실행 가능하게 함
                model: 'llama-3.1-8b-instant', 
                messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: prompt }],
                max_tokens: 5000,
                temperature: 0.4, // 온도를 낮춰서 헛소리 확률을 줄임
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
    console.log("🚀 bloginfo360 가벼운 엔진으로 전환 및 가동");
    
    const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    
    try {
        const res = await callGroqSafe(`한국의 최신 ${cat} 관련 실제 뉴스를 바탕으로 정보공유 포스팅과 카드뉴스 3장을 JSON으로 만들어줘.`);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const safeTitle = Math.random().toString(36).substring(7);
        const dir = path.join(ROOT, 'posts', cat);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        let body = `<div class="post-content">`;
        res.sections.forEach((s, idx) => {
            body += `<h2>${s.title}</h2><p>${s.content}</p>`;
            if (res.cardNews?.[idx]) body += `<div class="svg-card" style="margin:30px 0;">${res.cardNews[idx].svgCode}</div>`;
        });
        body += `</div>`;

        const finalFile = `---\nlayout: post\ntitle: "${res.title}"\ndate: ${dateStr}\ncategory: "${cat}"\n---\n${body}`;
        
        writeFileSync(path.join(dir, `${dateStr}-${safeTitle}.html`), finalFile);
        console.log(`✅ 발행 성공: ${res.title}`);

    } catch (e) {
        console.error("❌ 에러 발생:", e.message);
    }
}

run();
