// 토잡 — 체험단 게시판 /bbs/board.php?bo_table=blog_go
import * as cheerio from 'cheerio'
import { fetchWithRetry } from '../utils.mjs'

const BOARD_URL = 'https://www.tojobcn.com/bbs/board.php?bo_table=blog_go'

export async function parse(_baseUrl) {
  const campaigns = []
  for (let page = 1; page <= 3; page++) {
    try {
      const url = page === 1 ? BOARD_URL : `${BOARD_URL}&page=${page}`
      const res = await fetchWithRetry(url)
      const html = await res.text()
      const $ = cheerio.load(html)
      const items = [], seen = new Set()

      $('a[href*="wr_id="]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        if (!href.includes('blog_go')) return  // 다른 게시판 링크 제외
        const fullUrl = href.startsWith('http') ? href : `https://www.tojobcn.com${href}`
        if (seen.has(fullUrl)) return; seen.add(fullUrl)

        const title = $a.find('.ellipsis-link, [class*="title"], b').first().text().trim()
          || $a.text().replace(/\s+/g, ' ').trim()
        if (!title || title.length < 4) return

        items.push({ title, campaign_url: fullUrl, campaign_type: '블로그', applicants: 0, capacity: null, deadline_text: null })
      })

      if (items.length === 0) break
      campaigns.push(...items)
    } catch (err) { console.warn(`[토잡] 페이지 ${page} 실패:`, err.message); break }
    await new Promise(r => setTimeout(r, 800))
  }
  return campaigns
}
