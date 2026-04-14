// 서울오빠 — div.item > a[href*="campaign/?c="] > strong
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

      $('div.item').each((_, el) => {
        const $el = $(el)
        const $a = $el.find('a[href*="campaign/?c="]').first()
        const href = $a.attr('href') || ''
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `https://www.seoulouba.co.kr${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        const title = $a.find('strong').first().text().trim()
          || $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const deadlineText = $el.find('[class*="day"], [class*="dday"]').first().text().trim()
        const typeImg = $el.find('img[src*="thum_ch_"]').first().attr('src') || ''
        const applyText = $el.find('[class*="apply"], [class*="cnt"]').first().text()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(typeImg),
          applicants: parseNum(applyText),
          capacity: null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[서울오빠] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

function detectType(src) {
  if (src.includes('reels') || src.includes('insta')) return '인스타'
  if (src.includes('youtube') || src.includes('tube')) return '유튜브'
  if (src.includes('tiktok')) return '틱톡'
  if (src.includes('visit')) return '방문'
  return '블로그'
}
