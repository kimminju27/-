// 메타체험단 — a[href*="campaign.php?cp_id="] (bloglab과 동일 구조)
import * as cheerio from 'cheerio'
import { fetchWithRetry } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []
  for (let page = 1; page <= 3; page++) {
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
        const title = $a.find('span.it_name, b, strong').first().text().trim()
          || $a.text().replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        items.push({ title, campaign_url: fullUrl, campaign_type: '블로그', applicants: 0, capacity: null, deadline_text: null })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[메타체험단] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}
