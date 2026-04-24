// 토잡 — 체험단 게시판 /bbs/board.php?bo_table=blog_go
import * as cheerio from 'cheerio'
import { fetchWithRetry, parseNum } from '../utils.mjs'

const BOARD_URL = 'https://www.tojobcn.com/bbs/board.php?bo_table=blog_go'

export async function parse(_baseUrl) {
  const campaigns = []
  for (let page = 1; page <= 10; page++) {
    try {
      const url = page === 1 ? BOARD_URL : `${BOARD_URL}&page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      // row-full-link: 카드 전체를 덮는 투명 오버레이 링크 → 부모 div.list-row에서 제목 추출
      $('a.row-full-link').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        if (!href.includes('blog_go')) return
        const fullUrl = href.startsWith('http') ? href : `https://www.tojobcn.com${href}`

        // 컨테이너: div.list-row 또는 직접 부모
        const $card = $a.closest('div.list-row') || $a.parent()
        // 제목: span 직계 텍스트 노드 중 첫 번째로 유효한 것
        let title = ''
        $card.find('span').each((_, s) => {
          const t = $(s).clone().children().remove().end().text().replace(/\s+/g, ' ').trim()
          if (t.length >= 6) { title = t; return false }
        })
        if (!title) title = $card.find('span').first().text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const deadlineText = $card.find('[class*="day"],[class*="dday"],[class*="remain"],[class*="deadline"],[class*="date"]').first().text().trim()
        const applyText = $card.find('[class*="apply"],[class*="cnt"],[class*="count"]').first().text()
        const capacityText = $card.find('[class*="limit"],[class*="total"],[class*="quota"]').first().text()
        items.push({ title, campaign_url: fullUrl, campaign_type: null,
          applicants: parseNum(applyText),
          capacity: parseNum(capacityText) || null,
          deadline_text: deadlineText || null,
        })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[토잡] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}
