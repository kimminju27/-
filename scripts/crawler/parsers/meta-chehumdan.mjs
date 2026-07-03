// 메타체험단 — Playwright, campaign.php?cp_id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, 'campaign.php?cp_id=', {
    extraWaitMs: 6000, scrollCount: 20, scrollWaitMs: 1500,
  })
}
