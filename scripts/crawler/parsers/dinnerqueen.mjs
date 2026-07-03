// 다이닝퀸 — Playwright (React SPA), /taste/숫자 패턴, 무한스크롤+더보기 지원
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 무한스크롤 + 더보기 버튼 모두 시도 (scrollCount 30으로 대폭 증가)
  const items = await playwrightParse(baseUrl, '/taste/', {
    extraWaitMs: 4000,
    scrollCount: 30,
    scrollWaitMs: 2000,
  })
  return items
}
