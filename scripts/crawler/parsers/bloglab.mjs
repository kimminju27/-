// 블로그랩 — JS 동적 렌더링, campaign.php?cp_id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaign.php', {
    extraWaitMs: 4000, scrollCount: 15, scrollWaitMs: 1500,
  })
}

