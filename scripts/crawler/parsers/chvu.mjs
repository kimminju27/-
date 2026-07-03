// 체뷰 — SPA (React/Vue), Playwright 휴리스틱
import { playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParseHeuristic(baseUrl, {
    extraWaitMs: 3000, scrollCount: 20, scrollWaitMs: 1500,
  })
}
