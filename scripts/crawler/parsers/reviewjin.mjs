// 리뷰진 — SPA 추정, Playwright 휴리스틱
import { playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 2000 })
}
