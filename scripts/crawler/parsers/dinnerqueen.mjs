// 다이닝퀸 — swiper-slide > a[href*="/taste/"]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType as _detectType } from '../utils.mjs'
// 다이닝퀸 기본값은 '방문' (맛집 특화 사이트)
function detectType(text) { if (!text) return '방문'; const r = _detectType(text); return r === '블로그' ? '방문' : r }

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

      $('a[href*="/taste/"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        if (!/\/taste\/\d+/.test(href)) return

        const fullUrl = href.startsWith('http') ? href : `https://dinnerqueen.net${href}`
        if (seen.has(fullUrl)) return
        seen.add(fullUrl)

        // img alt가 URL이면 무시, 유효하면 사용
        const imgAlt = ($el.find('img').first().attr('alt') || '').trim()
        const altClean = /^https?:\/\//.test(imgAlt) ? '' : imgAlt
        // span들 중 URL이 아니고 4자 이상인 마지막 것 = 제목 (배지/상태 span 제외)
        let spanTitle = ''
        $el.find('span').each((_, s) => {
          const t = $(s).text().trim()
          if (t.length > 3 && !/^https?:\/\//.test(t)) spanTitle = t
        })
        const title = altClean || spanTitle
        if (!title || title.length < 4 || /^https?:\/\//.test(title)) return

        const $card = $el.closest('.swiper-slide, [class*="card"], [class*="item"]')
        const deadlineText = $card.find('[class*="day"], [class*="dday"], [class*="deadline"]').first().text().trim()
        const typeText = $card.find('[class*="type"], [class*="category"]').first().text().trim()
        const applyText = $card.find('[class*="apply"], [class*="count"]').first().text()
        const capacityText = $card.find('[class*="limit"], [class*="total"]').first().text()

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
      console.warn(`[다이닝퀸] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

