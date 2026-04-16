// 아싸뷰 — JS 클릭 이벤트 방식, Playwright 휴리스틱
import { playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000 })
}
