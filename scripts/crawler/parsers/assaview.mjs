// 아싸뷰 — .campaign_card > a[href*="campaign.php?cp_id="] > span.subject
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

      $('.campaign_card').each((_, el) => {
        const $el = $(el)
        const $a = $el.find('a[href*="campaign.php?cp_id="]').first()
        const href = $a.attr('href') || ''
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const rawTitle = $a.find('span.subject').first().text().trim()
          || $a.text().replace(/\s+/g, ' ').trim()
        // 날짜/시간 prefix 제거: "2026/04/21 23:59:59 " 패턴
        const title = rawTitle
          .replace(/^\d{4}[\/\-]\d{2}[\/\-]\d{2}\s+\d{2}:\d{2}:\d{2}\s*/, '')
          .trim()
        if (!title || title.length < 4) return

        const deadlineText = $el.find('[class*="day"], [class*="dday"], .deadline').first().text().trim()
        const typeText = $el.find('[class*="type"], [class*="sns"], .assign_type_chip').first().text().trim()
        const applyText = $el.find('[class*="apply"], [class*="count"], .cnt').first().text()
        const capacityText = $el.find('[class*="limit"], [class*="total"], .max').first().text()

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
      console.warn(`[아싸뷰] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

function detectType(text) {
  if (!text) return '블로그'
  const t = text.toLowerCase()
  if (t.includes('인스타') || t.includes('reels')) return '인스타'
  if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
  if (t.includes('틱톡')) return '틱톡'
  if (t.includes('방문')) return '방문'
  return '블로그'
}
