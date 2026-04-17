// 클라우드리뷰 — Playwright, /campaign/detail/ 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaign/detail/', { extraWaitMs: 6000 })
}
