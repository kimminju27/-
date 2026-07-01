// 위리뷰 — SPA (React+Mantine), Playwright 휴리스틱
import { playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500 })
}
