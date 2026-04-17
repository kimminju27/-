// 모단 — SPA, /shop_view/?idx= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/shop_view/', { extraWaitMs: 8000 })
}
