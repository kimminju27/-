// 덩덩뷰 — 반려동물 체험단, review_campaign.php?cp_id= 패턴
// 1차: 정적 fetch (사이트 접근 가능), 2차: Playwright 폴백
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 1차: 정적 fetch
  try {
    const campaigns = []
    const origin = new URL(baseUrl).origin

    for (let page = 1; page <= 10; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      $('a[href*="review_campaign.php?cp_id="]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const fullUrl = href.startsWith('http') ? href : `${origin}/${href.replace(/^\//, '')}`
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const title = $a.find('b, strong, [class*="title"], [class*="name"], [class*="subject"]').first().text().trim()
          || $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const $card = $a.closest('li, [class*="card"], [class*="item"], tr')
        const deadlineText = $card.find('[class*="day"],[class*="dday"],[class*="deadline"],[class*="date"],[class*="remain"]').first().text().trim()
        const typeText = $card.find('[class*="type"],[class*="channel"],[class*="media"],[class*="badge"]').first().text().trim()
        const applyText = $card.find('[class*="apply"],[class*="cnt"],[class*="count"]').first().text()
        const capacityText = $card.find('[class*="limit"],[class*="total"],[class*="quota"]').first().text()

        items.push({
          title, campaign_url: fullUrl,
          campaign_type: detectType(typeText),
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

  // 2차: Playwright 폴백
  return playwrightParse(baseUrl, 'review_campaign.php?cp_id=', { extraWaitMs: 6000 })
}
