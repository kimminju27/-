// 미스터블로그 파서
// 캠페인 URL 패턴: /campaigns/[ID]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 3; page++) {
    try {
      const url = page === 1 ? `${baseUrl}campaigns` : `${baseUrl}campaigns?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)

      const items = []

      // 캠페인 카드: href="/campaigns/숫자" 패턴의 a 태그
      $('a[href*="/campaigns/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''

        // 캠페인 상세 링크만 (목록/필터 링크 제외)
        if (!/\/campaigns\/\d+/.test(href)) return

        const title = $el.find('h3, h4, [class*="title"], [class*="name"], p').first().text().trim()
          || $el.text().replace(/\s+/g, ' ').trim()

        if (!title || title.length < 6) return

        const deadlineText = $el.find('[class*="day"], [class*="deadline"], [class*="date"], .dday').first().text().trim()
        const typeText = $el.find('[class*="type"], [class*="channel"], .reels, .clip').first().text().trim()
        const applyText = $el.find('[class*="apply"], [class*="count"]').first().text()
        const capacityText = $el.find('[class*="limit"], [class*="total"], [class*="capacity"]').first().text()

        items.push({
          title,
          campaign_url: href.startsWith('http') ? href : `https://www.mrblog.net${href}`,
          campaign_type: detectType(typeText),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[미스터블로그] 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}

