// 서울오빠 — fetch 차단 시 Playwright 폴백
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 1차: 정적 fetch 시도
  try {
    const campaigns = []
    for (let page = 1; page <= 30; page++) {
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
        const title = $a.find('strong').first().text().trim() || $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        const deadlineText = $el.find('[class*="dday"],[class*="d-day"],[class*="remain"],[class*="deadline"],[class*="day"],[class*="date"]').first().text().trim()
        const typeImgSrc = $el.find('img[src*="thum_ch_"]').first().attr('src') || ''
        const categoryText = $el.find('[class*="tag"],[class*="type"],[class*="category"],[class*="badge"]').first().text().trim()
        const applyText = $el.find('[class*="apply"],[class*="cnt"]').first().text()
        const capacityText = $el.find('[class*="limit"],[class*="total"],[class*="quota"],[class*="count"]').first().text()
        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(categoryText, typeImgSrc ? [typeImgSrc] : []),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
        })
      })
      if (items.length === 0) break
      campaigns.push(...items)
      await new Promise(r => setTimeout(r, 800))
    }
    if (campaigns.length > 0) return campaigns
  } catch (_) {}

  // 2차: Playwright 폴백 (fetch 차단 시)
  const r = await playwrightParse(baseUrl, 'campaign/?c=', {
    extraWaitMs: 4000, scrollCount: 20, scrollWaitMs: 1500,
  })
  if (r.length > 0) return r
  return playwrightParseHeuristic(baseUrl, {
    extraWaitMs: 4000, scrollCount: 20, scrollWaitMs: 1500,
  })
}

