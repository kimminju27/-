// 체험단모음 (xn--o39a04kpnjo4k9hgflp.com) — AJAX 로드, Playwright로 /cmp/?id= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/cmp/?id=', { extraWaitMs: 3000 })
}
