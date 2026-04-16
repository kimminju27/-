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
        const rawTitle = $el.find('h2, h3, h4, [class*="title"], [class*="name"], p').first().text().trim()
          || $el.text().replace(/\s+/g, ' ').trim()
        const title = rawTitle
          .replace(/\d{4}[.\/-]\d{2}[.\/-]\d{2}(\s*\d{2}:\d{2}(:\d{2})?)?/g, '')
          .replace(/\(?\s*신청\s*[\d,]+\s*\/\s*[\d,]+\s*명?\s*\)?/g, '')
          .replace(/\d+\s*일\s*남음/g, '').replace(/D-\d+/gi, '')
          .replace(/^(매장방문형|배송형|구매형|방문형|재택형)\s*/g, '')
          .replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const $card = $el.closest('[class*="card"], [class*="item"], li')
        const deadlineText = $card.find('[class*="dday"],[class*="d-day"],[class*="remain"],[class*="day"],[class*="deadline"],[class*="timer"],[class*="date"]').first().text().trim()
        const typeText = $card.find('[class*="type"],[class*="category"],[class*="tag"],[class*="badge"],[class*="kind"],[class*="channel"],[class*="media"]').first().text().trim()
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

