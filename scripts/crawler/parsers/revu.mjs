// 레뷰 — SPA (React), /project/ 패턴 우선, 실패 시 휴리스틱 폴백
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const r = await playwrightParse(baseUrl, '/project/', { extraWaitMs: 3000 })
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000 })
}
