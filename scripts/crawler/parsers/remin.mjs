// 리뷰의민족 (remin.co.kr) — GitHub Actions IP 차단으로 타임아웃 발생 → gotoTimeout 단축
import { playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParseHeuristic('https://remin.co.kr/category/campaignlist', {
    extraWaitMs: 3000,
    gotoTimeout: 12000,
  })
}
