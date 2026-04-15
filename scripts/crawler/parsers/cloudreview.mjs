// 클라우드리뷰 — a[href*="/campaign/detail/"]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 3; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = []
      const seen = new Set()

      $('a[href*="/campaign/detail/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!/\/campaign\/detail\/\d+/.test(href)) return

        const fullUrl = href.startsWith('http') ? href : `https://cloudreview.co.kr${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const title = $el.find('h2, h3, h4, [class*="title"], [class*="name"], p').first().text().trim()
          || $el.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const $card = $el.closest('[class*="card"], [class*="item"], li')
        const deadlineText = $card.find('[class*="day"], [class*="deadline"]').first().text().trim()
        const typeText = $card.find('[class*="type"], [class*="category"]').first().text().trim()
        const applyText = $card.find('[class*="apply"], [class*="count"]').first().text()
        const capacityText = $card.find('[class*="limit"], [class*="모집"]').first().text()

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
      console.warn(`[클라우드리뷰] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

