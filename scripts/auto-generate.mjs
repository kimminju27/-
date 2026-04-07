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
  '보험':   { emoji: '🛡️', gradient: 'from-blue-50 to-indigo-100',   badge: 'badge-보험',   ogImage: '/og-default.svg' },
  '세금':   { emoji: '📋', gradient: 'from-red-50 to-orange-100',    badge: 'badge-세금',   ogImage: '/og-default.svg' },
  '부동산': { emoji: '🏠', gradient: 'from-indigo-50 to-purple-100', badge: 'badge-부동산', ogImage: '/og-realestate.svg' },
  '복지':   { emoji: '🤝', gradient: 'from-violet-50 to-purple-100', badge: 'badge-복지',   ogImage: '/og-welfare.svg' },
  '주식':   { emoji: '📈', gradient: 'from-green-50 to-emerald-100', badge: 'badge-주식',   ogImage: '/og-stock.svg' },
  '경제':   { emoji: '💰', gradient: 'from-yellow-50 to-amber-100',  badge: 'badge-경제',   ogImage: '/og-economy.svg' },
  '복지정책': { emoji: '🤝', gradient: 'from-violet-50 to-purple-100', badge: 'badge-복지', ogImage: '/og-welfare.svg' },
  '리뷰':   { emoji: '⭐', gradient: 'from-sky-50 to-blue-100',     badge: 'badge-제품리뷰', ogImage: '/og-review.svg' },
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META['경제'];
}

/**
 * Groq API 호출 — 명시적 JSON 구조 요청
 */
async function callGroq(prompt, retryCount = 0) {
  const systemMsg = `당신은 한국어 정보 블로그 작가입니다.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "title": "글 제목 (60자 이내, 검색 키워드 포함)",
  "description": "메타 설명 (80~120자, 핵심 키워드 포함)",
  "category": "카테고리명",
  "slug": "영문-하이픈-슬러그 (30자 이내)",
  "tags": ["태그1", "태그2", "태그3"],
  "keyPoints": ["핵심 포인트 1 (구체적 숫자 포함)", "핵심 포인트 2", "핵심 포인트 3"],
  "sections": [
    {"id": "section1", "title": "첫 번째 소제목", "content": "400자 이상의 본문 내용. 구어체로 친근하게. 구체적 수치와 공식 출처 포함."},
    {"id": "section2", "title": "두 번째 소제목", "content": "400자 이상"},
    {"id": "section3", "title": "세 번째 소제목", "content": "400자 이상"},
    {"id": "section4", "title": "네 번째 소제목 — 정리", "content": "400자 이상"}
  ],
  "faqs": [
    {"question": "자주 묻는 질문 1", "answer": "구체적 답변"},
    {"question": "자주 묻는 질문 2", "answer": "구체적 답변"},
    {"question": "자주 묻는 질문 3", "answer": "구체적 답변"}
  ],
  "sources": [
    {"name": "출처 기관명 — 문서 제목 (YYYY.MM)", "url": "#"}
  ]
}

작성 규칙:
- 말투: '~하더라고요', '~인 셈이죠' 등 친근한 구어체
- sections는 반드시 4개 이상, 각 400자 이상
- faqs는 반드시 3개
- 2026년 최신 기준으로 작성`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt }
      ],
      max_tokens: 8000,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API 오류 ${res.status}: ${errText}`);
  }

  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    throw new Error(`Groq 응답 형식 오류: ${JSON.stringify(data)}`);
  }

  let content;
  try {
    content = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    throw new Error(`JSON 파싱 실패: ${data.choices[0].message.content.slice(0, 200)}`);
  }

  // sections 검증
  if (!Array.isArray(content.sections) || content.sections.length === 0) {
    if (retryCount < 2) {
      console.warn(`⚠️ sections 누락, 재시도 ${retryCount + 1}/2...`);
      return callGroq(prompt + '\n\n[중요] sections 배열을 반드시 4개 이상 포함하세요!', retryCount + 1);
    }
    throw new Error('sections 배열이 없습니다. Groq 응답 구조 오류.');
  }

  // 짧은 섹션 재시도
  const shortSection = content.sections.some(s => (s.content || '').length < 200);
  if (shortSection && retryCount < 1) {
    console.warn(`⚠️ 섹션 내용 너무 짧음, 재시도...`);
    return callGroq(prompt + '\n\n[중요] 각 섹션 content는 반드시 400자 이상으로 작성하세요!', retryCount + 1);
  }

  return content;
}

/**
 * 뉴스 수집
 */
async function fetchNewsData(category) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (items.length === 0) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 5))];
    const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
    const title = (titleMatch?.[1] || '').replace(/ - .*$/, '').trim();
    const description = (descMatch?.[1] || '').trim();
    if (!title) return null;
    return { title, description };
  } catch (e) {
    console.warn(`⚠️ 뉴스 수집 실패 (${category}): ${e.message}`);
    return null;
  }
}

/**
 * 포스트 HTML 빌드 (템플릿 기반)
 */
function buildPostHTML(data, slug, dateStr) {
  const meta = getCategoryMeta(data.category);
  const dateFormatted = dateStr.replace(/-/g, '.');
  const isoDate = `${dateStr}T00:00:00+09:00`;
  const postUrl = `https://bloginfo360.com/posts/${slug}`;

  const sectionsHTML = (data.sections || []).map((s, idx) => {
    const adAfterSection1 = idx === 1 ? `
        <!-- 광고: 글 중간 -->
        <div class="not-prose my-8">
          <ins class="adsbygoogle"
               style="display:block; text-align:center;"
               data-ad-client="ca-pub-1954893264438671"
               data-ad-slot="4402487501"
               data-ad-format="fluid"
               data-ad-layout="in-article"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
        </div>` : '';
    return `${adAfterSection1}
          <h2 id="${s.id || `section${idx + 1}`}">${s.title}</h2>
          <p>${(s.content || '').replace(/\n/g, '</p><p>')}</p>`;
  }).join('\n');

  const faqsHTML = (data.faqs || []).map(f => `
          <details class="faq-item not-prose border border-ink-100 rounded-xl p-4 mb-3">
            <summary class="flex items-center justify-between font-bold text-ink-900 text-sm select-none">
              <span>${f.question}</span>
              <span class="faq-icon text-ink-400 text-xl font-light">+</span>
            </summary>
            <p class="mt-3 text-sm text-ink-500 leading-relaxed">${f.answer}</p>
          </details>`).join('\n');

  const faqJsonLD = (data.faqs || []).map(f => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer }
  }));

  const keyPointsHTML = (data.keyPoints || ['핵심 정보 1', '핵심 정보 2', '핵심 정보 3']).map(p => `
            <li class="flex items-start gap-2 text-sm text-ink-700 leading-relaxed">
              <span class="text-brand-600 font-black shrink-0 mt-0.5">✓</span>
              <span>${p}</span>
            </li>`).join('\n');

  const tagsHTML = (data.tags || []).map(t => `<span class="text-xs text-ink-500 bg-ink-100 px-2.5 py-1 rounded-full">#${t}</span>`).join('\n          ');

  const sourcesHTML = (data.sources || [{ name: '공식 자료 기반 작성', url: '#' }]).map(s =>
    `<li class="text-xs text-ink-500 flex items-start gap-1.5">
              <span class="text-ink-300 shrink-0">•</span>
              <a href="${s.url}" target="_blank" rel="noopener" class="hover:text-brand-600 transition-colors underline decoration-dotted">${s.name}</a>
            </li>`).join('\n          ');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/analytics.js" async></script>
  <title>${data.title} | 나만 모르는 요즘 소식</title>
  <meta name="description" content="${data.description}">
  <meta name="keywords" content="${(data.tags || []).join(', ')}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="김민주">
  <link rel="canonical" href="${postUrl}">
  <meta name="google-adsense-account" content="ca-pub-1954893264438671">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1954893264438671" crossorigin="anonymous"></script>
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
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${data.title}",
    "description": "${data.description}",
    "datePublished": "${dateStr}",
    "dateModified": "${dateStr}",
    "author": { "@type": "Person", "name": "김민주", "url": "https://bloginfo360.com/about" },
    "publisher": { "@type": "Organization", "name": "나만 모르는 요즘 소식", "url": "https://bloginfo360.com" },
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${postUrl}" },
    "image": "https://bloginfo360.com${meta.ogImage}",
    "inLanguage": "ko-KR"
  }
  </script>
  ${faqJsonLD.length > 0 ? `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": ${JSON.stringify(faqJsonLD, null, 2)}
  }
  </script>` : ''}
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "홈", "item": "https://bloginfo360.com/" },
      { "@type": "ListItem", "position": 2, "name": "${data.category}", "item": "https://bloginfo360.com/#category" },
      { "@type": "ListItem", "position": 3, "name": "${data.title}", "item": "${postUrl}" }
    ]
  }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:"#f0fdf4", 100:"#dcfce7", 200:"#bbf7d0", 600:"#16a34a", 700:"#15803d" },
            gold:  { 400:"#fbbf24", 500:"#f59e0b" },
            ink:   { 900:"#0f172a", 700:"#1e293b", 500:"#475569", 300:"#94a3b8", 100:"#f1f5f9" }
          },
          fontFamily: { sans: ["Noto Sans KR", "sans-serif"] }
        }
      }
    }
  </script>
  <style>
    body { font-family: "Noto Sans KR", sans-serif; }
    .prose h2 { font-size: 1.35rem; font-weight: 700; margin: 2.5rem 0 0.8rem; color: #0f172a; border-left: 4px solid #16a34a; padding-left: 12px; line-height: 1.5; }
    .prose h3 { font-size: 1.08rem; font-weight: 700; margin: 1.8rem 0 0.5rem; color: #1e293b; }
    .prose p  { line-height: 1.95; margin-bottom: 1.15rem; color: #475569; font-size: 0.97rem; }
    .prose ul { list-style: disc; padding-left: 1.5rem; margin-bottom: 1rem; color: #475569; font-size: 0.97rem; }
    .prose ul li { margin-bottom: 0.45rem; line-height: 1.75; }
    .prose strong { color: #0f172a; font-weight: 700; }
    .prose a { color: #16a34a; text-decoration: underline; }
    .prose blockquote { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 0 8px 8px 0; margin: 1.5rem 0; color: #1e293b; font-size: 0.95rem; line-height: 1.8; }
    .prose table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
    .prose table th { background: #f1f5f9; font-weight: 700; padding: 10px 14px; text-align: left; color: #1e293b; border-bottom: 2px solid #e2e8f0; }
    .prose table td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #475569; }
    .prose hr { border: none; border-top: 1px solid #e2e8f0; margin: 2.5rem 0; }
    .btn-share { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; border: 1.5px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; transition: all 0.15s; text-decoration: none; white-space: nowrap; }
    .btn-share:hover { border-color: #16a34a; color: #16a34a; background: #f0fdf4; }
    .toc-link { display: block; padding: 4px 0 4px 10px; color: #475569; font-size: 0.83rem; text-decoration: none; border-left: 2px solid transparent; transition: all 0.15s; }
    .toc-link:hover { color: #16a34a; border-left-color: #bbf7d0; }
    .toc-link.active { color: #16a34a; border-left-color: #16a34a; font-weight: 600; }
    .badge-보험   { background: #dbeafe; color: #1e40af; }
    .badge-세금   { background: #fee2e2; color: #b91c1c; }
    .badge-부동산 { background: #e0e7ff; color: #3730a3; }
    .badge-복지, .badge-복지정책 { background: #f3e8ff; color: #7c3aed; }
    .badge-주식   { background: #dcfce7; color: #166534; }
    .badge-경제   { background: #fef9c3; color: #854d0e; }
    .badge-제품리뷰 { background: #e0f2fe; color: #0369a1; }
    .faq-item { cursor: pointer; }
    .faq-item summary { list-style: none; }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item[open] summary .faq-icon { transform: rotate(45deg); }
    .faq-icon { transition: transform 0.2s; display: inline-block; }
  </style>
</head>
<body class="bg-white text-ink-900">
  <header class="sticky top-0 z-50 bg-white border-b border-ink-100 shadow-sm">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="../index.html" class="text-xl font-black text-brand-600 leading-tight">나만 모르는<br class="sm:hidden"> 요즘 소식</a>
      <nav class="hidden sm:flex items-center gap-6 text-sm font-medium text-ink-500">
        <a href="../index.html" class="hover:text-brand-600 transition-colors">홈</a>
        <a href="../index.html#category" class="hover:text-brand-600 transition-colors">카테고리</a>
        <a href="../about.html" class="hover:text-brand-600 transition-colors">소개</a>
      </nav>
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
      <article class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-2 items-center mb-4">
          <span class="text-xs font-bold px-2.5 py-0.5 rounded-full ${meta.badge}">${data.category}</span>
          <span class="text-xs text-ink-300">${dateFormatted}</span>
        </div>

        <h1 class="text-2xl sm:text-3xl font-black text-ink-900 leading-tight mb-3">${data.title}</h1>
        <p class="text-ink-500 text-sm mb-6 leading-relaxed">${data.description}</p>

        <div class="flex items-center gap-3 mb-8 pb-6 border-b border-ink-100">
          <div class="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white font-black text-sm shrink-0">민</div>
          <div>
            <a href="../about.html" class="text-sm font-bold text-ink-900 hover:text-brand-600 transition-colors">김민주</a>
            <p class="text-xs text-ink-300">나만 모르는 요즘 소식 운영자 · 공식 자료 기반 팩트체크</p>
          </div>
        </div>

        <div class="w-full h-52 sm:h-64 bg-gradient-to-br ${meta.gradient} rounded-2xl flex items-center justify-center text-7xl mb-8" role="img" aria-label="${data.title}">
          ${meta.emoji}
        </div>

        <div class="bg-brand-50 border border-brand-200 rounded-2xl p-5 mb-8">
          <p class="text-xs font-bold text-brand-700 uppercase tracking-wide mb-3">이 글의 핵심</p>
          <ul class="space-y-2.5">
          ${keyPointsHTML}
          </ul>
        </div>

        <!-- 광고: 글 상단 -->
        <div class="my-6">
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-1954893264438671"
               data-ad-slot="4667480307"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
        </div>

        <div class="prose" id="article-body">
          ${sectionsHTML}

          <hr>

          <h2 id="faq">자주 묻는 질문 (FAQ)</h2>
          ${faqsHTML}
        </div>

        <!-- 광고: 글 하단 -->
        <div class="my-8">
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-1954893264438671"
               data-ad-slot="7573679395"
               data-ad-format="autorelaxed"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
        </div>

        <div class="bg-ink-100/40 rounded-2xl p-5 mb-5">
          <p class="text-xs font-bold text-ink-500 uppercase tracking-wide mb-3">출처 및 참고자료</p>
          <ul class="space-y-1.5">
          ${sourcesHTML}
          </ul>
        </div>

        <div class="border border-amber-200 bg-amber-50 rounded-2xl p-4 mb-8">
          <p class="text-xs font-bold text-amber-700 mb-1.5">면책조항</p>
          <p class="text-xs text-amber-700 leading-relaxed">
            이 글은 일반적인 정보 제공 목적으로 작성되었으며, 투자·재정·세무·법률 전문가의 조언을 대체하지 않습니다.
            개인 상황에 따라 결과가 다를 수 있으므로 중요한 결정 전 반드시 해당 분야 전문가와 상담하시기 바랍니다.
          </p>
        </div>

        <div class="mb-8 flex flex-wrap gap-2">
          ${tagsHTML}
        </div>

        <div class="pt-6 border-t border-ink-100 flex flex-wrap gap-2 mb-2">
          <button class="btn-share" onclick="copyLink()">🔗 링크 복사</button>
          <a class="btn-share" id="twitterShare" href="#" target="_blank" rel="noopener">🐦 X 공유</a>
          <a class="btn-share" id="fbShare" href="#" target="_blank" rel="noopener">📘 페이스북</a>
        </div>
        <p id="copyMsg" class="text-xs text-brand-600 mt-2 mb-8 hidden">링크가 복사되었습니다!</p>

      </article>

      <aside class="w-full lg:w-64 shrink-0">
        <div class="sticky top-20 space-y-6">
          <div class="bg-ink-100/50 rounded-2xl p-5">
            <p class="text-xs font-bold text-ink-500 uppercase mb-3 tracking-wide">목차</p>
            <nav id="tocNav" class="space-y-0.5"></nav>
          </div>

          <div class="bg-brand-600 rounded-2xl p-5 text-white">
            <p class="font-bold text-sm mb-1">새 글 알림 받기</p>
            <p class="text-brand-200 text-xs mb-3">보험·세금·부동산 인사이트를 이메일로</p>
            <a href="../index.html#newsletter" class="block text-center bg-white text-brand-600 text-xs font-bold py-2 rounded-lg hover:bg-brand-50 transition-colors">무료 구독</a>
          </div>

          <!-- 광고: 사이드바 -->
          <div>
            <ins class="adsbygoogle"
                 style="display:block"
                 data-ad-format="fluid"
                 data-ad-layout-key="-6t+ed+2i-1n-4w"
                 data-ad-client="ca-pub-1954893264438671"
                 data-ad-slot="8738587259"></ins>
            <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
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
    (function() {
      const body = document.getElementById('article-body');
      if (!body) return;
      const chars = body.innerText.trim().replace(/\s+/g, '').length;
      const mins = Math.max(1, Math.ceil(chars / 600));
      document.getElementById('readTime') && (document.getElementById('readTime').textContent = '읽는 시간 약 ' + mins + '분');
    })();

    (function() {
      const headings = document.querySelectorAll('#article-body h2');
      const toc = document.getElementById('tocNav');
      if (!toc || headings.length === 0) return;
      headings.forEach((h, i) => {
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.className = 'toc-link';
        a.textContent = (i + 1) + '. ' + h.textContent.trim();
        toc.appendChild(a);
      });
    })();

    (function() {
      const url = encodeURIComponent(window.location.href);
      const title = encodeURIComponent(document.title);
      const tw = document.getElementById('twitterShare');
      const fb = document.getElementById('fbShare');
      if (tw) tw.href = 'https://twitter.com/intent/tweet?text=' + title + '&url=' + url;
      if (fb) fb.href = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
    })();

    function copyLink() {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const msg = document.getElementById('copyMsg');
        if (msg) { msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 2500); }
      });
    }
  </script>
</body>
</html>`;
}

/**
 * posts/ 에 HTML 파일 저장 (플랫 구조)
 */
function savePost(data, slug, dateStr) {
  const postsDir = path.join(ROOT, 'posts');
  if (!existsSync(postsDir)) mkdirSync(postsDir, { recursive: true });

  const html = buildPostHTML(data, slug, dateStr);
  const filePath = path.join(postsDir, `${slug}.html`);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ 포스트 저장: posts/${slug}.html`);
  return filePath;
}

/**
 * index.html 포스트 카드 추가
 */
function updateIndex(data, slug, dateStr) {
  const indexPath = path.join(ROOT, 'index.html');
  if (!existsSync(indexPath)) return;

  const meta = getCategoryMeta(data.category);
  const dateFormatted = dateStr.replace(/-/g, '.');
  const card = `
      <article class="post-item" data-category="${data.category}" data-title="${data.title}">
        <a href="posts/${slug}.html" class="block bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover post-card overflow-hidden">
          <div class="w-full h-44 bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-5xl">${meta.emoji}</div>
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

/**
 * sitemap.xml 업데이트
 */
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

/**
 * feed.xml 업데이트
 */
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
  // 첫 번째 <item> 앞에 삽입
  content = content.replace('<item>', `${item}\n\n    <item>`);
  writeFileSync(feedPath, content, 'utf-8');
  console.log(`✅ feed.xml 업데이트`);
}

/**
 * topics-history.json 업데이트
 */
function updateTopicsHistory(data, slug, dateStr) {
  const histPath = path.join(ROOT, 'topics-history.json');
  let history = [];
  if (existsSync(histPath)) {
    try { history = JSON.parse(readFileSync(histPath, 'utf-8')); } catch {}
  }
  history.unshift({ slug, title: data.title, category: data.category, date: dateStr });
  // 최근 100개만 유지
  if (history.length > 100) history = history.slice(0, 100);
  writeFileSync(histPath, JSON.stringify(history, null, 2), 'utf-8');
  console.log(`✅ topics-history.json 업데이트`);
}

/**
 * 슬러그 생성
 */
function makeSlug(title, category, dateStr) {
  // Groq가 영문 slug를 제공하면 사용, 없으면 생성
  const base = category.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + dateStr.replace(/-/g, '');
  return base.slice(0, 40);
}

/**
 * 메인
 */
async function run() {
  console.log(`🚀 자동 글 생성 시작 (모드: ${GENERATION_MODE}, 카테고리: ${CATEGORIES.join(', ')})`);

  if (!GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY 환경변수가 없습니다.');
    process.exit(1);
  }

  const dateStr = new Date().toISOString().split('T')[0];

  if (GENERATION_MODE === 'news') {
    let successCount = 0;
    for (const category of CATEGORIES) {
      try {
        console.log(`\n📰 [${category}] 뉴스 수집 중...`);
        const topic = await fetchNewsData(category);

        let prompt;
        if (topic) {
          prompt = `카테고리: ${category}\n뉴스 제목: ${topic.title}\n뉴스 요약: ${topic.description}\n\n위 뉴스를 기반으로 "${category}" 카테고리의 정보성 블로그 포스팅을 작성해주세요. 2026년 최신 정보를 반영하세요.`;
        } else {
          prompt = `카테고리: ${category}\n\n"${category}" 주제로 2026년 최신 정보를 담은 정보성 블로그 포스팅을 작성해주세요.`;
        }

        console.log(`🤖 Groq AI 생성 중...`);
        const result = await callGroq(prompt);

        const slug = result.slug
          ? result.slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40)
          : makeSlug(result.title, category, dateStr);

        savePost(result, slug, dateStr);
        updateIndex(result, slug, dateStr);
        updateSitemap(slug, dateStr);
        updateFeed(result, slug, dateStr);
        updateTopicsHistory(result, slug, dateStr);

        successCount++;
        console.log(`✅ [${category}] 완료: ${result.title}`);
      } catch (e) {
        console.error(`❌ [${category}] 실패: ${e.message}`);
      }
    }

    console.log(`\n🎉 완료: ${successCount}/${CATEGORIES.length}개 생성`);

  } else if (GENERATION_MODE === 'product_review') {
    const productLinksEnv = process.env.PRODUCT_LINKS || '';
    const lines = productLinksEnv.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length === 0) {
      console.log('❌ PRODUCT_LINKS 환경변수가 비어있습니다.');
      return;
    }

    for (const line of lines) {
      try {
        const parts = line.split('|');
        const affiliateUrl = parts[0]?.trim();
        const platform = parts[1]?.trim() || 'coupang';
        if (!affiliateUrl) continue;

        const prompt = `플랫폼: ${platform}\n링크: ${affiliateUrl}\n\n위 제품에 대한 솔직한 사용 후기 블로그 리뷰를 작성해주세요. category는 "리뷰"로 설정하세요.`;
        const result = await callGroq(prompt);
        result.category = result.category || '리뷰';

        const slug = result.slug
          ? result.slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40)
          : makeSlug(result.title, 'review', dateStr);

        savePost(result, slug, dateStr);
        updateIndex(result, slug, dateStr);
        updateSitemap(slug, dateStr);
        updateFeed(result, slug, dateStr);
        updateTopicsHistory(result, slug, dateStr);

        console.log(`✅ 리뷰 완료: ${result.title}`);
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
