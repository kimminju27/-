// 레뷰 (revu.net) 파서
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 3; page++) {
    try {
      const url = `${baseUrl}campaigns?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)

      const items = []

      $('[class*="campaign"], .item, article').each((_, el) => {
        const $el = $(el)
        const $link = $el.find('a[href*="campaign"]').first()
        const title = $el.find('[class*="title"], h3, h4, p.name').first().text().trim()
          || $link.text().trim()
        const href = $link.attr('href') || $el.find('a').first().attr('href')

        if (!title || !href || title.length < 5) return

        const typeEl = $el.find('[class*="type"], [class*="channel"]').first().text().trim()
        const applyEl = $el.find('[class*="apply"], [class*="count"]').first().text()
        const capacityEl = $el.find('[class*="limit"], [class*="total"]').first().text()
        const deadlineEl = $el.find('[class*="day"], [class*="date"]').first().text().trim()

        items.push({
          title,
          campaign_url: href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}${href}`,
          campaign_type: detectType(typeEl),
          applicants: parseNum(applyEl),
          capacity: parseNum(capacityEl) || null,
          deadline_text: deadlineEl || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[레뷰] 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}

