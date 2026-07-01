// 리뷰노트 — /campaigns/숫자 패턴, Playwright (정적 fetch 페이지네이션 미작동)
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaigns/', { extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500 })
}
