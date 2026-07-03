// 체험단(chehumdan.com) — 페이지네이션 다중 페이지 수집
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  const allResults = []
  const seen = new Set()

  for (let page = 1; page <= 15; page++) {
    const url = `${baseUrl}index.php?page=${page}`
    const items = await playwrightParse(url, 'detail.php?number=', {
      extraWaitMs: 4000, scrollCount: 5, scrollWaitMs: 1500,
    })
    if (items.length === 0) break
    for (const item of items) {
      if (!seen.has(item.campaign_url)) {
        seen.add(item.campaign_url)
        allResults.push(item)
      }
    }
    if (items.length < 5) break
  }

  return allResults
}
