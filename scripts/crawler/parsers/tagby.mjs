// 태그바이 — Nuxt.js SPA, /campaigns/ 경로 시도 후 휴리스틱
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const r = await playwrightParse(baseUrl, '/campaigns/', { extraWaitMs: 2000, scrollCount: 15, scrollWaitMs: 1500 })
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 2000, scrollCount: 10, scrollWaitMs: 1500 })
}
