// 범용 HTML 파서 템플릿
// 각 사이트 파서가 이 함수를 활용
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum, detectType } from '../utils.mjs'

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

        let title = config.titleSelector
          ? $el.find(config.titleSelector).first().text().trim()
          : $el.find('h2, h3, h4, .title, [class*="title"], [class*="subject"]').first().text().trim()

        // fallback: a 태그 텍스트
        if (!title || title.length < 6) {
          title = $el.find('a').first().text().replace(/\s+/g, ' ').trim()
        }

        // 불필요한 부분 제거 (날짜·상태·카운트 텍스트 등)
        title = title
          .replace(/\d{4}[.\/-]\d{2}[.\/-]\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?/g, '')
          .replace(/^(배송형|구매형|방문형|재택형|구매평형)\s*/g, '')
          .replace(/\d+\s*일\s*남음/g, '')
          .replace(/신청\s*[\d,]+\s*\/\s*[\d,]+명?/g, '')
          .replace(/D-\d+/g, '')
          .replace(/\s*오늘\s*마감/g, '')
          .replace(/\s+/g, ' ')
          .trim()

        const $a = config.linkSelector
          ? $el.find(config.linkSelector).first()
          : $el.find('a').first()
        const href = $a.attr('href') || ''

        if (!title || title.length < 6) return

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

// detectType은 utils.mjs에서 import해서 사용
