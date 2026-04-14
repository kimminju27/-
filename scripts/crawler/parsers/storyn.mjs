// 스토리엔 — a[href*="review_campaign.php?cp_id="]
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

export async function parse(baseUrl) {
  return parseCpId(baseUrl, '스토리엔', 'review_campaign.php?cp_id=')
}

// 공통 cp_id 파서 (스토리엔/덩덩뷰/파블로뷰 공용)
export async function parseCpId(baseUrl, name, hrefKey) {
  const campaigns = []
  for (let page = 1; page <= 3; page++) {
    try {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      $(`a[href*="${hrefKey}"]`).each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        // 제목: strong/b 먼저, 없으면 가장 긴 div 텍스트
        let title = $a.find('strong, b').first().text().trim()
        if (!title) {
          $a.find('div').each((_, d) => {
            const t = $(d).clone().children().remove().end().text().trim()
            if (t.length > title.length && t.length > 5 && !/^\[/.test(t)) title = t
          })
        }
        if (!title) title = $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        const typeText = $a.find('span, div').first().text().trim()
        items.push({
          title, campaign_url: fullUrl,
          campaign_type: detectType(typeText),
          applicants: 0, capacity: null, deadline_text: null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[${name}] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}

function detectType(t) {
  if (!t) return '블로그'
  if (t.includes('인스타') || t.includes('릴스') || t.includes('Reels')) return '인스타'
  if (t.includes('유튜브') || t.includes('YouTube')) return '유튜브'
  if (t.includes('방문')) return '방문'
  return '블로그'
}
