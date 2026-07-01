// 블로그체험단 (xn--939au0g4vj8sq.net) — Playwright, /cp/?id= 패턴
// GitHub Actions IP 차단으로 타임아웃 발생 → gotoTimeout 단축
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/cp/?id=', { extraWaitMs: 3000, gotoTimeout: 12000, scrollCount: 10, scrollWaitMs: 1500 })
}
