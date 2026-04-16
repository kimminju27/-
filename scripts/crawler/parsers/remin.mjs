// 리뷰의민족 (remin.co.kr) — JS onClick 링크, Playwright 휴리스틱
import { playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParseHeuristic('https://remin.co.kr/category/campaignlist', {
    extraWaitMs: 3000,
  })
}
