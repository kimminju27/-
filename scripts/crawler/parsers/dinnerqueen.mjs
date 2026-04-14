// 다이닝퀸 — swiper-slide > a[href*="/taste/"]
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
      const items = []
      const seen = new Set()

      $('a[href*="/taste/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!/\/taste\/\d+/.test(href)) return

        const fullUrl = href.startsWith('http') ? href : `https://dinnerqueen.net${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        // 제목: img alt 또는 링크 내 텍스트
        const title = ($el.find('img').first().attr('alt') || $el.text()).replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const $card = $el.closest('.swiper-slide, [class*="card"], [class*="item"]')
        const deadlineText = $card.find('[class*="day"], [class*="dday"], [class*="deadline"]').first().text().trim()
        const typeText = $card.find('[class*="type"], [class*="category"]').first().text().trim()
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
      console.warn(`[다이닝퀸] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

function detectType(text) {
  if (!text) return '방문'
  const t = text.toLowerCase()
  if (t.includes('인스타') || t.includes('reels') || t.includes('릴스')) return '인스타'
  if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
  if (t.includes('블로그')) return '블로그'
  return '방문'
}
