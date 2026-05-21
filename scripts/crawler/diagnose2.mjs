// 상세 구조 진단 — 링크 주변 HTML 확인
import * as cheerio from 'cheerio'

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(12000),
  })
  return res.text()
}

// 체험단(chehumdan.com) — detail.php?number= 텍스트 왜 비어있나
async function diagChehumdan() {
  console.log('\n=== 체험단 (chehumdan.com) ===')
  const html = await fetchHtml('https://chehumdan.com/')
  const $ = cheerio.load(html)
  $('a[href*="detail.php?number="]').slice(0, 3).each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    const innerHtml = $a.html()?.slice(0, 200)
    const $parent = $a.parent()
    const $card = $a.closest('[class]')
    console.log(`\nhref: ${href}`)
    console.log(`a innerHTML: ${innerHtml}`)
    console.log(`parent tag: <${$parent[0]?.name} class="${$parent.attr('class')}">`)
    console.log(`card class: ${$card.attr('class')}`)
    console.log(`card text: ${$card.text().replace(/\s+/g, ' ').trim().slice(0, 100)}`)
  })
}

// 투잡커넥트 — row-full-link li 구조 확인
async function diagTojob() {
  console.log('\n=== 투잡커넥트 ===')
  const html = await fetchHtml('https://www.tojobcn.com/bbs/board.php?bo_table=blog_go')
  const $ = cheerio.load(html)
  $('a.row-full-link').slice(0, 2).each((_, el) => {
    const $a = $(el)
    const $li = $a.closest('li')
    const href = $a.attr('href')
    console.log(`\nhref: ${href}`)
    // li 전체 구조
    const liHtml = $li.html()?.replace(/\s+/g, ' ').slice(0, 500)
    console.log(`li html: ${liHtml}`)
    // 모든 div 텍스트
    $li.find('div').each((_, d) => {
      const t = $(d).clone().children().remove().end().text().replace(/\s+/g, ' ').trim()
      if (t) console.log(`  div direct text: "${t}"`)
    })
    $li.find('span, p, strong, b, h3, h4').each((_, d) => {
      const t = $(d).text().replace(/\s+/g, ' ').trim()
      if (t) console.log(`  ${d.name}: "${t.slice(0, 60)}"`)
    })
  })
}

// 클라우드리뷰 — fetchWithRetry 흉내 (User-Agent 없이)
async function diagCloudreview() {
  console.log('\n=== 클라우드리뷰 (User-Agent 없이) ===')
  try {
    const res = await fetch('https://cloudreview.co.kr/', { signal: AbortSignal.timeout(10000) })
    const html = await res.text()
    const $ = cheerio.load(html)
    const count = $('a[href*="/campaign/detail/"]').length
    console.log(`링크 수: ${count}`)
    if (count > 0) {
      $('a[href*="/campaign/detail/"]').slice(0, 3).each((_, el) => {
        const $a = $(el)
        console.log(`  href: ${$a.attr('href')}, text: "${$a.text().replace(/\s+/g, ' ').trim().slice(0, 50)}"`)
      })
    } else {
      console.log('HTML 앞부분:', html.slice(0, 300))
    }
  } catch (e) { console.log('오류:', e.message) }
}

// 덩덩뷰 — 실제 캠페인 링크 확인 (Playwright 없이)
async function diagDengdeng() {
  console.log('\n=== 덩덩뷰 (campaign detail 링크) ===')
  const html = await fetchHtml('https://www.dengdengview.co.kr/review_campaign_list.php')
  const $ = cheerio.load(html)
  // review_campaign.php 포함 링크
  const detailLinks = $('a[href*="review_campaign.php"]').not('[href*="list"]')
  console.log(`review_campaign.php (non-list) 링크: ${detailLinks.length}`)
  detailLinks.slice(0, 3).each((_, el) => {
    console.log(`  href: ${$(el).attr('href')}, text: "${$(el).text().replace(/\s+/g, ' ').trim().slice(0, 60)}"`)
  })
  // 전체 a href 패턴 중 cp_id=숫자 있는 것
  const cpIdLinks = $('a').filter((_, el) => /cp_id=\d+/.test($(el).attr('href') || ''))
  console.log(`cp_id=숫자 링크: ${cpIdLinks.length}`)
  cpIdLinks.slice(0, 3).each((_, el) => {
    console.log(`  href: ${$(el).attr('href')?.slice(0, 80)}`)
  })
}

try { await diagChehumdan() } catch(e) { console.log('체험단 오류:', e.message) }
try { await diagTojob() } catch(e) { console.log('투잡 오류:', e.message) }
try { await diagCloudreview() } catch(e) { console.log('클라우드리뷰 오류:', e.message) }
try { await diagDengdeng() } catch(e) { console.log('덩덩뷰 오류:', e.message) }
console.log('\n진단2 완료')
