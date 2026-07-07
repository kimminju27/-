// 헬로우리뷰
import { genericParse } from './_generic.mjs'
import { playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  const items = await genericParse(baseUrl, {
    listSelector: '[class*="campaign"], [class*="item"], [class*="card"], .list li, article, .board_list li',
    titleSelector: '[class*="title"], h3, h4, h2, .subject',
    linkSelector: 'a',
    typeSelector: '[class*="type"], [class*="badge"]',
    deadlineSelector: '[class*="day"], [class*="dday"], [class*="deadline"]',
    maxPages: 15,
  })
  if (items.length > 0) return items
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500 })
}
