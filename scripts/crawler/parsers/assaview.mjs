// 아싸뷰 — <a class="campaign_card"> 자체가 앵커
// span.subject = 제목, .timer = 마감, 아이콘 src로 채널 타입 감지
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

      // .campaign_card 자체가 <a> 엘리먼트
      $('a.campaign_card').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `https://assaview.co.kr${href.startsWith('/') ? '' : '/'}${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        // 제목: span.subject
        const title = $el.find('span.subject').first().text().trim()
        if (!title || title.length < 4) return

        // 마감일: .timer
        const deadlineText = $el.find('.timer, span.timer').first().text().trim() || null

        // 신청자/모집 인원: 카드 텍스트에서 "신청 N / N명" 패턴 추출
        const rawText = $el.text()
        const countMatch = rawText.match(/신청\s*([\d,]+)\s*\/\s*([\d,]+)/)
        const applicants = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : 0
        const capacity = countMatch ? parseInt(countMatch[2].replace(/,/g, '')) : null

        // 채널 타입: 카드 내 아이콘 src로 감지
        const imgSrcs = []
        $el.find('img').each((_, img) => {
          const s = $(img).attr('src') || ''
          if (s) imgSrcs.push(s)
        })
        // 텍스트 기반 보조 감지 (assign_type_chip 등)
        const typeText = $el.find('.assign_type_chip, [class*="type"], [class*="channel"]').first().text().trim()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(typeText, imgSrcs),
          applicants,
          capacity: capacity || null,
          deadline_text: deadlineText,
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
