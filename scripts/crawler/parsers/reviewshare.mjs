// 리뷰쉐어 (reviewshare.io) 파서
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 3; page++) {
    try {
      const url = `${baseUrl}campaigns?page=${page}&status=open`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)

      const items = []

      // 캠페인 카드 셀렉터 (사이트 구조에 맞게)
      $('[class*="campaign-item"], [class*="campaign-card"], .item-wrap, li.campaign').each((_, el) => {
        const $el = $(el)
        const title = $el.find('[class*="title"], h3, h4, .name').first().text().trim()
        const link = $el.find('a').first().attr('href')
        const applyText = $el.find('[class*="apply"], [class*="count"], .apply-count').first().text()
        const capacityText = $el.find('[class*="capacity"], [class*="limit"], .total').first().text()
        const deadline = $el.find('[class*="dday"],[class*="d-day"],[class*="remain"],[class*="day"],[class*="deadline"],[class*="timer"],[class*="date"],[class*="expire"]').first().text().trim()
        const typeText = $el.find('[class*="type"],[class*="channel"],[class*="media"],[class*="tag"],[class*="badge"],[class*="kind"],[class*="category"]').first().text().trim()

        if (!title || !link) return

        items.push({
          title,
          campaign_url: link.startsWith('http') ? link : `${baseUrl}${link.replace(/^\//, '')}`,
          campaign_type: detectType(typeText),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadline || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[리뷰쉐어] 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}

