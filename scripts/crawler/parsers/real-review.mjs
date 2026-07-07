// 리얼리뷰 — HTML 우선, Playwright 폴백
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'
import { playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 20; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = []
      const seen = new Set()

      // 다양한 링크 패턴 시도
      const linkSelectors = ['a._o-title', 'a[href*="/project/"]', 'a[href*="/campaign/"]', '.campaign-item a', '.list-item a']
      let $links = $()
      for (const sel of linkSelectors) {
        $links = $(sel)
        if ($links.length > 0) break
      }

      $links.each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        const fullUrl = href.startsWith('http') ? href : `https://www.real-review.kr${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const title = $el.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const $card = $el.closest('[class*="card"], [class*="item"], li, article')
        const deadlineText = $card.find('[class*="day"],[class*="remain"],[class*="deadline"],[class*="date"]').first().text().trim()
        const typeText = $card.find('[class*="type"],[class*="channel"],[class*="badge"]').first().text().trim()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(typeText),
          applicants: null,
          capacity: null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[리얼리뷰] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }

  if (campaigns.length > 0) return campaigns

  // Playwright 폴백
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 4000, scrollCount: 20, scrollWaitMs: 1500 })
}
