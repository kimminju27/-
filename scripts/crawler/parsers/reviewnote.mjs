// 리뷰노트 파서
// 캠페인 URL 패턴: /campaigns/[ID]
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

      // 캠페인 카드: href="/campaigns/숫자" 패턴
      $('a[href*="/campaigns/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''

        if (!/\/campaigns\/\d+/.test(href)) return

        // 제목: 내부 텍스트 정제 (공백/개행 압축)
        const rawText = $el.text().replace(/\s+/g, ' ').trim()
        // 날짜/숫자/상태 텍스트를 제거하고 순수 제목만 추출
        const title = rawText
          .replace(/\d+\s*일\s*남음/g, '')
          .replace(/신청\s*\d+\s*\/\s*\d+/g, '')
          .replace(/D-\d+/g, '')
          .replace(/\s+/g, ' ')
          .trim()

        if (!title || title.length < 6) return

        const deadlineText = $el.find('[class*="dday"],[class*="d-day"],[class*="remain"],[class*="day"],[class*="deadline"],[class*="timer"],[class*="date"],[class*="expire"]').first().text().trim()
        const typeText = $el.find('[class*="type"],[class*="channel"],[class*="media"],[class*="tag"],[class*="badge"],[class*="kind"],[class*="category"]').first().text().trim()
        const applyText = $el.find('[class*="apply"], [class*="count"]').first().text()
        const capacityText = $el.find('[class*="limit"], [class*="total"]').first().text()

        items.push({
          title,
          campaign_url: href.startsWith('http') ? href : `https://www.reviewnote.co.kr${href}`,
          campaign_type: detectType(typeText),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) {
      console.warn(`[리뷰노트] 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}

