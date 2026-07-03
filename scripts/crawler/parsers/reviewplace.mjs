// 리뷰플레이스 — Playwright (SPA 가능성)
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  let items = await playwrightParse(baseUrl, '/campaign/', {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
  if (items.length > 0) return items

  items = await playwrightParse(baseUrl, '/review/', {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
  if (items.length > 0) return items

  return playwrightParseHeuristic(baseUrl, {
    extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500,
  })
}
