// 체험단(chehumdan.com) 파서
// 캠페인 URL 패턴: detail.php?number=숫자
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

export async function parse(baseUrl) {
  const campaigns = []

  for (let page = 1; page <= 3; page++) {
    try {
      const url = page === 1 ? `${baseUrl}index.php` : `${baseUrl}list.php?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)

      const items = []
      const seen = new Set()

      // 캠페인 링크: detail.php?number= 패턴
      $('a[href*="detail.php?number="]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`

        const title = $el.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 6) return
        // 중복 방지
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        // 상태: 상시모집, 신청 X / 모집 Y 등
        const parentEl = $el.closest('li, .item, .box, tr, div[class]')
        const statusText = parentEl.find('[class*="status"], [class*="badge"], [class*="label"]').first().text().trim()
        const applyText = parentEl.find('[class*="apply"], [class*="count"]').first().text()
        const deadlineText = parentEl.find('[class*="day"], [class*="date"], [class*="deadline"]').first().text().trim()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: '블로그',
          applicants: parseNum(applyText),
          capacity: null,
          deadline_text: statusText || deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[체험단] 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}
