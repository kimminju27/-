// 서울오빠 — div.item > a[href*="campaign/?c="] > strong
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

        const deadlineText = $el.find(
          '[class*="dday"],[class*="d-day"],[class*="d_day"],[class*="remain"],[class*="deadline"],[class*="expire"],[class*="day"],[class*="timer"],[class*="date"]'
        ).first().text().trim()
        const typeImgSrc = $el.find('img[src*="thum_ch_"]').first().attr('src') || ''
        // 매장방문형 등 카테고리 텍스트도 함께 전달 (다중 타입 감지)
        const categoryText = $el.find('[class*="tag"],[class*="type"],[class*="category"],[class*="badge"],[class*="kind"]').first().text().trim()
        const applyText = $el.find('[class*="apply"], [class*="cnt"]').first().text()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(categoryText, typeImgSrc ? [typeImgSrc] : []),
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

