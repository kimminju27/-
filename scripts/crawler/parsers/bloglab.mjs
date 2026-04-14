// 블로그랩 — a[href*="campaign.php?cp_id="] > b
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

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

function detectType(t) {
  if (!t) return '블로그'
  if (t.includes('인스타') || t.includes('릴스')) return '인스타'
  if (t.includes('유튜브')) return '유튜브'
  if (t.includes('방문')) return '방문'
  return '블로그'
}
