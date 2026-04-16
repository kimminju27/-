// 리뷰쉐어 — SPA (React), /project/ 경로 시도 후 휴리스틱
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const r = await playwrightParse(
    'https://reviewshare.io/project',
    '/project/',
    { extraWaitMs: 2000 }
  )
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 2000 })
}
