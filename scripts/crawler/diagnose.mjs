// 문제 파서 진단 스크립트
// 실행: node scripts/crawler/diagnose.mjs
import * as cheerio from 'cheerio'

const SITES = [
  { name: '덩덩뷰',    url: 'https://www.dengdengview.co.kr/review_campaign_list.php' },
  { name: '메타체험단', url: 'https://meta-chehumdan.com/campaign_list.php' },
  { name: '링블',      url: 'https://www.ringble.co.kr/index_mobile.php' },
  { name: '클라우드리뷰', url: 'https://cloudreview.co.kr/' },
  { name: '체험단',    url: 'https://chehumdan.com/' },
  { name: '투잡커넥트', url: 'https://www.tojobcn.com/bbs/board.php?bo_table=blog_go' },
  { name: '블로그체험', url: 'https://xn--5y2bw0fi0u.kr/' },
  { name: '미블',      url: 'https://mrblog.co.kr/campaigns' },
]

const KEYWORDS = ['cp_id', 'campaign', 'detail', 'number', 'blog_go', 'view', 'post', 'list']

async function diagnose({ name, url }) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[${name}] ${url}`)
  console.log('='.repeat(60))
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) { console.log(`  HTTP ${res.status}`); return }
    const html = await res.text()
    const $ = cheerio.load(html)

    // 각 키워드별 링크 수 및 샘플
    for (const kw of KEYWORDS) {
      const els = $(`a[href*="${kw}"]`)
      if (els.length === 0) continue
      console.log(`\n  [href*="${kw}"] → ${els.length}개`)
      els.slice(0, 3).each((_, el) => {
        const href = $(el).attr('href') || ''
        const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 60)
        console.log(`    href: ${href}`)
        console.log(`    text: "${text}"`)
      })
    }

    // row-full-link (투잡)
    const fullLinks = $('a.row-full-link')
    if (fullLinks.length > 0) {
      console.log(`\n  [a.row-full-link] → ${fullLinks.length}개`)
      fullLinks.slice(0, 3).each((_, el) => {
        const $li = $(el).closest('li')
        const href = $(el).attr('href') || ''
        const divText = $li.find('div[style]').map((_, d) => $(d).text().trim()).get().join(' | ')
        console.log(`    href: ${href}`)
        console.log(`    li div texts: ${divText.slice(0, 100)}`)
      })
    }

    // 전체 링크 패턴 (중복 제거, 상위 15개)
    const hrefs = new Set()
    $('a[href]').each((_, el) => {
      const h = $(el).attr('href') || ''
      if (h && !h.startsWith('#') && !h.startsWith('javascript') && !h.startsWith('mailto')) {
        const path = h.split('?')[0].split('#')[0]
        if (path.length > 1) hrefs.add(path)
      }
    })
    console.log(`\n  전체 링크 경로 (상위 15개):`)
    ;[...hrefs].slice(0, 15).forEach(h => console.log(`    ${h}`))

  } catch (err) {
    console.log(`  ERROR: ${err.message}`)
  }
}

for (const site of SITES) {
  await diagnose(site)
  await new Promise(r => setTimeout(r, 1200))
}
console.log('\n진단 완료')
