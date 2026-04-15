// 아싸뷰 — .campaign_card > a[href*="campaign.php?cp_id="] > span.subject
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

      $('.campaign_card').each((_, el) => {
        const $el = $(el)
        const $a = $el.find('a[href*="campaign.php?cp_id="]').first()
        const href = $a.attr('href') || ''
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        // .timer 제거한 clone에서 제목 추출 (timer가 $a.text() fallback에 섞이는 것 방지)
        const $aClone = $a.clone()
        $aClone.find('.timer, [class*="timer"]').remove()
        const title = $aClone.find('span.subject').first().text().trim()
          || $aClone.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        // .timer → deadline으로 활용
        const timerText = $a.find('.timer, span.timer').first().text().trim()
        const deadlineText = timerText || $el.find('[class*="day"], [class*="dday"], .deadline').first().text().trim()
        const typeText = $el.find('[class*="type"], [class*="sns"], .assign_type_chip').first().text().trim()
        const applyText = $el.find('[class*="apply"], [class*="count"], .cnt').first().text()
        const capacityText = $el.find('[class*="limit"], [class*="total"], .max').first().text()

        items.push({
          title,
          campaign_url: fullUrl,
          campaign_type: detectType(typeText),
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
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

function detectType(text) {
  if (!text) return '블로그'
  const t = text.toLowerCase()
  if (t.includes('인스타') || t.includes('reels')) return '인스타'
  if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
  if (t.includes('틱톡')) return '틱톡'
  if (t.includes('방문')) return '방문'
  return '블로그'
}
