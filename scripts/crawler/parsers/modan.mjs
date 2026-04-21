// 모단 — SPA, /shop_view/?idx= 패턴 → 0결과 시 휴리스틱 폴백
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const r = await playwrightParse(baseUrl, '/shop_view/', { extraWaitMs: 8000 })
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 6000 })
}
