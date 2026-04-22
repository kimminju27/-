// 스토리엔 — a[href*="review_campaign.php?cp_id="]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

export async function parse(baseUrl) {
  return parseCpId(baseUrl, '스토리엔', 'review_campaign.php?cp_id=')
}

// 공통 cp_id 파서 (스토리엔/덩덩뷰/파블로뷰 공용)
export async function parseCpId(baseUrl, name, hrefKey) {
  const campaigns = []
  const origin = new URL(baseUrl).origin
  for (let page = 1; page <= 10; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      $(`a[href*="${hrefKey}"]`).each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const fullUrl = href.startsWith('http')
          ? href
          : href.startsWith('/')
            ? `${origin}${href}`
            : `${origin}/${href}`

        // 제목: it_name → strong/b → 가장 긴 div 텍스트 순서로 탐색
        let title = $a.find('span.it_name, span.subject, .title, strong, b').first().text().trim()
        if (!title) {
          $a.find('div, span').each((_, d) => {
            const t = $(d).clone().children().remove().end().text().trim()
            if (t.length > title.length && t.length > 5 && !/^\[/.test(t)) title = t
          })
        }
        if (!title) title = $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        // 제목이 있을 때만 seen 체크 (이미지 링크 먼저 만나도 무시 안 되도록)
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const typeText = $a.find('span.sns, span.channel, .option2 span').first().text().trim()
        const $card = $a.closest('li, [class*="card"], [class*="item"], tr')
        const deadlineText = $card.find('[class*="day"],[class*="dday"],[class*="remain"],[class*="deadline"],[class*="date"]').first().text().trim()
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
    } catch (err) { console.warn(`[${name}] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

