// 블로그체험단 (xn--939au0g4vj8sq.net) — Playwright, /cp/?id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/cp/?id=', { extraWaitMs: 3000 })
}
