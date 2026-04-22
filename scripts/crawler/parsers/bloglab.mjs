// 블로그랩 — a[href*="campaign.php?cp_id="] > b
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
      const items = [], seen = new Set()

      $('a[href*="campaign.php?cp_id="]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const title = $a.find('b').first().text().trim()
          || $a.text().replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const typeText = $a.find('span').first().text().trim()
        items.push({
          title, campaign_url: fullUrl,
          campaign_type: detectType(typeText),
          applicants: 0, capacity: null, deadline_text: null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[블로그랩] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

