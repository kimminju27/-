// 컴투플레이 — a[href*="item.php?it_id="]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []
  for (let page = 1; page <= 10; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      $('a[href*="item.php?it_id="]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
        const title = $a.find('span.it_name, b, strong, [class*="title"], [class*="name"]').first().text().trim()
          || $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const $card = $a.closest('li, [class*="item"]')
        const deadlineText = $card.find('[class*="day"],[class*="dday"],[class*="remain"],[class*="deadline"],[class*="date"]').first().text().trim()
        const applyText = $card.find('[class*="apply"], [class*="cnt"]').first().text()
        const capacityText = $card.find('[class*="limit"], [class*="total"]').first().text()

        items.push({
          title, campaign_url: fullUrl, campaign_type: null,
          applicants: parseNum(applyText), capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[컴투플레이] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}
