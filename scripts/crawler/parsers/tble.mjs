// 티블 — Playwright (SPA, /product/ 또는 /campaign/ 패턴)
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 1차: /product/ 패턴 시도
  let items = await playwrightParse(baseUrl, '/product/', {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
  if (items.length > 0) return items

  // 2차: /campaign/ 패턴
  items = await playwrightParse(baseUrl, '/campaign/', {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
  if (items.length > 0) return items

  // 3차: 휴리스틱
  return playwrightParseHeuristic(baseUrl, {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
}
