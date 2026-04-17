// 블로그체험 (xn--5y2bw0fi0u.kr) — Playwright, cv_campaign.php?cp_id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, 'cv_campaign.php?cp_id=', { extraWaitMs: 3000 })
}
