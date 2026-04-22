// 리얼리뷰 — ._o-title[href*="/project/"]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 10; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = []
      const seen = new Set()

      $('a._o-title, a[href*="/project/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!href.includes('/project/')) return

        const fullUrl = href.startsWith('http') ? href : `https://www.real-review.kr${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const title = $el.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const $card = $el.closest('[class*="card"], [class*="item"], li, .c1fdo41gas3no')
        const deadlineText = $card.find('[class*="day"], [class*="deadline"]').first().text().trim()
        const typeText = $card.find('[class*="type"], [class*="channel"]').first().text().trim()
        const applyText = $card.find('[class*="apply"], [class*="count"]').first().text()
        const capacityText = $card.find('[class*="limit"], [class*="total"]').first().text()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(typeText),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
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
  return campaigns
}

