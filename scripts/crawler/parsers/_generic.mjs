// 범용 HTML 파서 템플릿
// 각 사이트 파서가 이 함수를 활용
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

/**
 * @param {string} baseUrl
 * @param {object} config
 * @param {string} config.listSelector - 캠페인 아이템 셀렉터
 * @param {string} config.titleSelector - 제목 셀렉터
 * @param {string} config.linkSelector - 링크 셀렉터 (없으면 가장 가까운 a)
 * @param {string} [config.typeSelector] - 유형 셀렉터
 * @param {string} [config.applicantsSelector] - 신청수 셀렉터
 * @param {string} [config.capacitySelector] - 모집수 셀렉터
 * @param {string} [config.deadlineSelector] - 마감일 셀렉터
 * @param {string} [config.pageParam] - 페이지 파라미터 이름 (기본: page)
 * @param {number} [config.maxPages] - 최대 페이지 수 (기본: 3)
 */
export async function genericParse(baseUrl, config) {
  const campaigns = []
  const pageParam = config.pageParam || 'page'
  const maxPages = config.maxPages || 3

  for (let page = 1; page <= maxPages; page++) {
    try {
      const separator = baseUrl.includes('?') ? '&' : '?'
      const url = page === 1 ? baseUrl : `${baseUrl}${separator}${pageParam}=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)

      const items = []

      $(config.listSelector).each((_, el) => {
        const $el = $(el)

        const title = config.titleSelector
          ? $el.find(config.titleSelector).first().text().trim()
          : $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim()

        const $a = config.linkSelector
          ? $el.find(config.linkSelector).first()
          : $el.find('a').first()
        const href = $a.attr('href') || ''

        if (!title || title.length < 3) return

        const fullUrl = href.startsWith('http')
          ? href
          : href ? `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}` : baseUrl

        const typeText = config.typeSelector
          ? $el.find(config.typeSelector).first().text().trim()
          : ''
        const applyText = config.applicantsSelector
          ? $el.find(config.applicantsSelector).first().text()
          : ''
        const capacityText = config.capacitySelector
          ? $el.find(config.capacitySelector).first().text()
          : ''
        const deadlineText = config.deadlineSelector
          ? $el.find(config.deadlineSelector).first().text().trim()
          : ''

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
      console.warn(`[generic] ${baseUrl} 페이지 ${page} 실패:`, err.message)
      break
    }

    await new Promise(r => setTimeout(r, 800))
  }

  return campaigns
}

export function detectType(text) {
  if (!text) return '블로그'
  const t = text.toLowerCase()
  if (t.includes('인스타') || t.includes('instagram')) return '인스타'
  if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
  if (t.includes('틱톡') || t.includes('tiktok')) return '틱톡'
  if (t.includes('방문')) return '방문'
  if (t.includes('재택')) return '재택'
  return '블로그'
}
