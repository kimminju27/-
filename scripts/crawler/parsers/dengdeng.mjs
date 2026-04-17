// 덩덩뷰 — Playwright, review_campaign.php?cp_id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, 'review_campaign.php?cp_id=', { extraWaitMs: 6000 })
}
