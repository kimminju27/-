// 리뷰진 — /community/ 패턴 우선 시도, 실패 시 휴리스틱
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const r = await playwrightParse(baseUrl, '/community/', {
    extraWaitMs: 3000, scrollCount: 20, scrollWaitMs: 1500,
  })
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, {
    extraWaitMs: 3000, scrollCount: 20, scrollWaitMs: 1500,
  })
}
