// Playwright 공용 유틸리티 — SPA 사이트 크롤링
import { chromium } from 'playwright'

let browser = null

export async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
  }
  return browser
}

export async function closeBrowser() {
  if (browser) {
    await browser.close()
    browser = null
  }
}

/**
 * 공통 제목 검증 (utils.mjs의 isValidTitle과 동일)
 */
const SKIP_TITLES = new Set([
  '로그인','회원가입','로그아웃','더보기','신청하기','자세히보기','홈','메인',
  '공지사항','이용약관','개인정보처리방침','고객센터','문의하기','나의활동',
  'login','signup','register','home','more','see more','view all',
])
function isValidTitle(t) {
  if (!t || t.length < 3 || t.length > 150) return false
  if (/^\d+$/.test(t)) return false
  if (SKIP_TITLES.has(t.toLowerCase())) return false
  return true
}

/**
 * URL이 캠페인 상세 페이지처럼 보이는지 휴리스틱 판단
 * - 같은 도메인
 * - path 깊이 ≥ 2 (/x/y 이상)
 * - path 내 숫자 또는 슬러그(하이픈+영숫자)
 * - 네비게이션 단어 제외
 */
const NAV_WORDS = ['login','logout','signup','register','about','contact','faq',
  'terms','policy','pricing','help','support','mypage','profile','notice','blog']
export function isCampaignUrl(href, origin) {
  try {
    const u = new URL(href)
    if (u.origin !== origin) return false
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return false
    const last = parts[parts.length - 1]
    const hasNumeric = /\d{3,}/.test(u.pathname)
    const hasSlug = /[a-zA-Z0-9가-힣]{4,}/.test(last)
    if (!hasNumeric && !hasSlug) return false
    if (NAV_WORDS.some(w => u.pathname.toLowerCase().includes(w))) return false
    return true
  } catch { return false }
}

/**
 * 지정 URL패턴으로 캠페인 링크 추출 (패턴 알 때)
 */
// 불필요한 리소스 차단 (이미지/폰트/미디어만, CSS는 허용) → IP 요청수 감소
async function blockResources(page) {
  await page.route('**/*', (route) => {
    const type = route.request().resourceType()
    if (['image', 'font', 'media', 'ping', 'websocket'].includes(type)) {
      route.abort()
    } else {
      route.continue()
    }
  })
}

// "더보기" 버튼 자동 클릭 시도 — 스크롤로 더 안 로드될 때 호출
async function clickLoadMore(page) {
  const selectors = [
    'button:has-text("더보기")', 'a:has-text("더보기")',
    'button:has-text("더 보기")', 'a:has-text("더 보기")',
    'button:has-text("MORE")', 'a:has-text("MORE")',
    'button:has-text("more")', 'a:has-text("more")',
    'button:has-text("다음")', 'a:has-text("다음")',
    '[class*="loadmore"]', '[class*="load-more"]',
    '[class*="more-btn"]', '[class*="btn-more"]',
    '#loadmore', '#load-more', '.load-more', '.loadmore',
  ]
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first()
      const visible = await btn.isVisible({ timeout: 800 }).catch(() => false)
      if (visible) {
        await btn.scrollIntoViewIfNeeded().catch(() => {})
        await btn.click({ timeout: 3000 })
        return true
      }
    } catch { /* 해당 셀렉터 없으면 다음 시도 */ }
  }
  return false
}

export async function playwrightParse(url, hrefKeyword, opts = {}) {
  const br = await getBrowser()
  const page = await br.newPage()
  try {
    await blockResources(page)
    // 리소스 차단 시 networkidle 대신 load 사용 (타임아웃 방지)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout || 30000 })
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 12000 }).catch(() => {})
    }
    // SPA 렌더링 대기 (최소 2초, extraWaitMs 우선)
    await page.waitForTimeout(opts.extraWaitMs || 2000)

    // 인피니티 스크롤 + 더보기 버튼 지원
    if (opts.scrollCount) {
      for (let i = 0; i < opts.scrollCount; i++) {
        const prevHeight = await page.evaluate(() => document.body.scrollHeight)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(opts.scrollWaitMs || 2000)
        const newHeight = await page.evaluate(() => document.body.scrollHeight)
        if (newHeight === prevHeight) {
          // 스크롤로 더 안 로드되면 "더보기" 버튼 시도
          const clicked = await clickLoadMore(page)
          if (!clicked) break
          await page.waitForTimeout(opts.scrollWaitMs || 2000)
        }
      }
    }

    const items = await page.evaluate(({keyword, titleSel}) => {
      function extractCardMeta(card) {
        if (!card) return { deadline_text: null, applicants: 0, capacity: null, channel_text: '' }
        // 마감일 — 1) 전용 클래스 엘리먼트 우선
        const ddEl = card.querySelector(
          '[class*="dday"],[class*="d-day"],[class*="remain"],[class*="deadline"],[class*="expire"],[class*="due"],[class*="period"],[class*="date"],[class*="day"],[class*="end"],[class*="close"],[class*="limit"],[class*="마감"],[class*="기간"]'
        )
        let deadline_text = ddEl ? ddEl.textContent.trim().slice(0, 40) : null
        // 2) 폴백: 카드 전체 텍스트에서 날짜/D-N 패턴 직접 탐지
        if (!deadline_text) {
          const cardText = card.innerText || ''
          const patterns = [
            /D-\d+/i,
            /\d+\s*일\s*남음/,
            /오늘\s*마감/,
            /상시\s*모집/,
            /\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/,
            /\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/,
            /\d{1,2}월\s*\d{1,2}일/,
            /[~까지]\s*\d{1,2}[\/\.]\d{1,2}/,
          ]
          for (const p of patterns) {
            const m = cardText.match(p)
            if (m) { deadline_text = m[0].trim().slice(0, 40); break }
          }
        }
        // 신청인원 ("신청4/10명" → 4, "4명" → 4)
        const apEl = card.querySelector(
          '[class*="apply"],[class*="applicant"],[class*="count"],[class*="people"],[class*="participant"],[class*="join"]'
        )
        const apRaw = apEl ? apEl.textContent : ''
        const apSlash = apRaw.match(/(\d+)\s*[\/|]/)
        const applicants = apEl ? (apSlash ? parseInt(apSlash[1]) : (parseInt(apRaw.replace(/[^0-9]/g,'')) || 0)) : 0
        // 모집인원 ("신청4/10명" → 10, "10명" → 10)
        const capEl = card.querySelector(
          '[class*="limit"],[class*="capacity"],[class*="quota"],[class*="max"],[class*="total"],[class*="recruit"]'
        )
        const capRaw = capEl ? capEl.textContent : ''
        const capSlash = capRaw.match(/[\/|]\s*([\d,]+)/)
        let capacity = null
        if (capEl) {
          capacity = capSlash ? parseInt(capSlash[1].replace(/,/g,'')) : (parseInt(capRaw.replace(/[^0-9]/g,'')) || null)
        }
        // 폴백: 신청인원 텍스트(apRaw)에 슬래시가 있으면 거기서 모집인원 추출
        if (!capacity && apRaw) {
          const apRawSlash = apRaw.match(/[\/|]\s*([\d,]+)/)
          if (apRawSlash) {
            capacity = parseInt(apRawSlash[1].replace(/,/g,''))
          }
        }
        // 채널 타입 뱃지 (인스타/유튜브/릴스 등)
        let channel_text = ''
        // 1) 클래스명에서 채널명 감지 우선 (예: blog-icon, insta-icon 등)
        const allElements = Array.from(card.querySelectorAll('*'))
        for (const el of allElements) {
          const cls = el.className || ''
          if (typeof cls === 'string') {
            if (cls.includes('blog-icon') || cls.includes('blog')) { channel_text = '블로그'; break }
            if (cls.includes('insta-icon') || cls.includes('instagram') || cls.includes('insta')) { channel_text = '인스타'; break }
            if (cls.includes('youtube-icon') || cls.includes('youtube')) { channel_text = '유튜브'; break }
            if (cls.includes('reels') || cls.includes('reel')) { channel_text = '릴스'; break }
          }
        }
        // 2) 클래스명 감지 실패 시 특정 채널 속성 엘리먼트 텍스트 조회
        if (!channel_text) {
          const chEl = card.querySelector(
            '[class*="channel"],[class*="media"],[class*="badge"],[class*="sns"],[class*="platform"],[class*="tag"],[class*="kind"],[class*="category"]'
          )
          channel_text = chEl ? chEl.textContent.trim() : ''
        }
        // 3) 그래도 실패 시 이미지 alt/src 기반 감지
        if (!channel_text) {
          const imgs = Array.from(card.querySelectorAll('img'))
          channel_text = imgs.map(i => ((i.alt || '') + ' ' + (i.src || '')).toLowerCase()).join(' ')
        }
        
        // 카드 전체 텍스트에서 명시적 배송/방문 단서 추출 (타이틀에 없어도 뱃지 등에 있을 수 있음)
        let delivery_type = null
        const fullTxt = card.innerText || ''
        if (fullTxt) {
          const lower = fullTxt.toLowerCase()
          if (lower.includes('구매평') || lower.includes('구매형')) delivery_type = '구매평'
          else if (lower.includes('기자단') || lower.includes('재택')) delivery_type = '재택형'
          else if (lower.includes('배송') || lower.includes('택배')) delivery_type = '배송형'
          else if (lower.includes('방문') || lower.includes('매장') || lower.includes('현장')) delivery_type = '방문형'
        }
        
        return { deadline_text, applicants, capacity, channel_text, delivery_type }
      }

      const results = [], seen = new Set()
      document.querySelectorAll('a[href]').forEach(el => {
        const href = el.href
        if (!href.includes(keyword)) return
        if (seen.has(href)) return
        let title = ''
        if (titleSel) {
          // 1) el 내부에서 찾기
          let tEl = el.querySelector(titleSel)
          // 2) 없으면 가장 가까운 카드 컨테이너에서 찾기 (dl>dt 등 a 밖에 있는 경우)
          if (!tEl) {
            const container = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="wrap"],div[class*="content"]')
            if (container) tEl = container.querySelector(titleSel)
          }
          // 3) 그래도 없으면 a 태그의 부모에서 찾기
          if (!tEl && el.parentElement) tEl = el.parentElement.querySelector(titleSel)
          if (tEl) {
            // img 태그면 alt 속성 사용 (썸네일에 제목이 alt로 있는 경우)
            if (tEl.tagName === 'IMG') {
              title = (tEl.getAttribute('alt') || '').trim()
            } else {
              title = tEl.textContent.replace(/\s+/g, ' ').trim()
            }
          }
        }
        if (!title) {
          const cands = el.querySelectorAll('h1,h2,h3,h4,strong,b,[class*="title"],[class*="name"],[class*="subject"]')
          for (const t of cands) {
            const txt = t.textContent.replace(/\s+/g, ' ').trim()
            if (txt.length >= 5 && txt.length <= 150) { title = txt; break }
          }
        }
        if (!title) title = el.innerText.replace(/\s+/g, ' ').trim()
        if (!title || title.length < 5) {
          const parent = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"],tr')
          if (parent) {
            const pc = parent.querySelectorAll('h1,h2,h3,h4,strong,b,[class*="title"],[class*="name"],[class*="subject"]')
            for (const t of pc) {
              const txt = t.textContent.replace(/\s+/g, ' ').trim()
              if (txt.length >= 3 && txt.length <= 150) { title = txt; break }
            }
          }
        }
        if (!title || title.length < 3 || title.length > 200) return
        seen.add(href)
        const card = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"],tr')
        
        // [브랜드]만 추출된 경우 el.innerText 첫 줄로 전체 제목 보완 (예: [누아트] → [누아트] 맥세이프 셀카봉)
        if (/^\[[^\]]+\]$/.test(title.trim())) {
          const firstLine = (el.innerText || '').split('\n')[0].replace(/\s+/g, ' ').trim()
          if (firstLine.length > title.length && firstLine.length <= 150) {
            title = firstLine
          }
        }
        
        // 카드 전체 텍스트에서 [지역/체험명] 패턴을 찾아 제목 앞에 보완
        if (card && !title.includes('[')) {
          const cardText = card.innerText || ''
          const bracketMatches = [...cardText.matchAll(/\[([\uac00-\ud7a30-9a-zA-Z\s\+\&]+)\]/g)]
          const regionBrackets = bracketMatches.filter(m => {
            const inner = m[1].trim()
            if (inner.length > 20) return false
            if (/^(NEW|BEST|D-\d+|\d+)$/i.test(inner)) return false
            return true
          })
          if (regionBrackets.length > 0) {
            const bracketStr = regionBrackets.map(m => `[${m[1].trim()}]`).join(' ')
            title = bracketStr + ' ' + title
          }
        }
        
        results.push({ title, campaign_url: href, ...extractCardMeta(card) })
      })
      return results
    }, {keyword: hrefKeyword, titleSel: opts.titleSelector || ''})

    function detectCh(text) {
      const t = (text || '').toLowerCase()
      if (t.includes('릴스') || t.includes('reels')) return '릴스'
      if (t.includes('클립')) return '클립'
      if (t.includes('인스타') || t.includes('instagram')) return '인스타'
      if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
      if (t.includes('틱톡') || t.includes('tiktok')) return '틱톡'
      return null
    }
    return items.map(r => ({
      ...r,
      campaign_type: opts.campaignType || detectCh((r.channel_text || '') + ' ' + r.title) || null,
    }))
  } catch (err) {
    console.warn(`[PW] ${url} 실패: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}

/**
 * 휴리스틱 파서 — URL 패턴 모를 때
 * DOM 내 캠페인처럼 생긴 링크를 자동 탐지
 */
export async function playwrightParseHeuristic(url, opts = {}) {
  const br = await getBrowser()
  const page = await br.newPage()
  try {
    await blockResources(page)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout || 30000 })
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 12000 }).catch(() => {})
    }
    await page.waitForTimeout(opts.extraWaitMs || 2000)

    // 인피니티 스크롤 + 더보기 버튼 지원
    if (opts.scrollCount) {
      for (let i = 0; i < opts.scrollCount; i++) {
        const prevHeight = await page.evaluate(() => document.body.scrollHeight)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(opts.scrollWaitMs || 2000)
        const newHeight = await page.evaluate(() => document.body.scrollHeight)
        if (newHeight === prevHeight) {
          const clicked = await clickLoadMore(page)
          if (!clicked) break
          await page.waitForTimeout(opts.scrollWaitMs || 2000)
        }
      }
    }

    const origin = new URL(url).origin
    const items = await page.evaluate(({originStr, navWords}) => {
      const results = [], seen = new Set()

      function isCampaignHref(href) {
        try {
          const u = new URL(href)
          if (u.origin !== originStr) return false
          const parts = u.pathname.split('/').filter(Boolean)
          if (parts.length < 1) return false
          const last = parts[parts.length - 1]
          const hasNumInPath = /\d{3,}/.test(u.pathname)
          const hasNumInQuery = /[?&](idx|id|no|seq|num)=\d+/.test(u.search)
          const hasSlug = /[a-zA-Z0-9가-힣-]{6,}/.test(last)
          // 1단계 경로: 쿼리에 숫자 ID가 있으면 허용 (예: /shop_view/?idx=123)
          if (parts.length === 1) {
            if (!hasNumInPath && !hasNumInQuery && !hasSlug) return false
          } else {
            if (!hasNumInPath && !hasNumInQuery && !hasSlug) return false
          }
          if (navWords.some(w => u.pathname.toLowerCase().includes(w))) return false
          return true
        } catch { return false }
      }

      function extractCardMeta(card) {
        if (!card) return { deadline_text: null, applicants: 0, capacity: null, channel_text: '' }
        const ddEl = card.querySelector(
          '[class*="dday"],[class*="d-day"],[class*="remain"],[class*="deadline"],[class*="expire"],[class*="due"],[class*="period"],[class*="date"],[class*="day"],[class*="end"],[class*="close"],[class*="limit"],[class*="마감"],[class*="기간"]'
        )
        let deadline_text = ddEl ? ddEl.textContent.trim().slice(0, 40) : null
        if (!deadline_text) {
          const cardText = card.innerText || ''
          const patterns = [
            /D-\d+/i,
            /\d+\s*일\s*남음/,
            /오늘\s*마감/,
            /상시\s*모집/,
            /\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/,
            /\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/,
            /\d{1,2}월\s*\d{1,2}일/,
            /[~까지]\s*\d{1,2}[\/\.]\d{1,2}/,
          ]
          for (const p of patterns) {
            const m = cardText.match(p)
            if (m) { deadline_text = m[0].trim().slice(0, 40); break }
          }
        }
        const apEl = card.querySelector(
          '[class*="apply"],[class*="applicant"],[class*="count"],[class*="people"],[class*="participant"],[class*="join"]'
        )
        const apRaw2 = apEl ? apEl.textContent : ''
        const apSlash2 = apRaw2.match(/(\d+)\s*[\/|]/)
        const applicants = apEl ? (apSlash2 ? parseInt(apSlash2[1]) : (parseInt(apRaw2.replace(/[^0-9]/g,'')) || 0)) : 0
        const capEl = card.querySelector(
          '[class*="limit"],[class*="capacity"],[class*="quota"],[class*="max"],[class*="total"],[class*="recruit"]'
        )
        const capRaw2 = capEl ? capEl.textContent : ''
        const capSlash2 = capRaw2.match(/[\/|]\s*(\d+)/)
        const capacity = capEl ? (capSlash2 ? parseInt(capSlash2[1]) : (parseInt(capRaw2.replace(/[^0-9]/g,'')) || null)) : null
        const chEl = card.querySelector(
          '[class*="channel"],[class*="media"],[class*="badge"],[class*="sns"],[class*="platform"],[class*="tag"],[class*="kind"],[class*="type"],[class*="category"]'
        )
        let channel_text = chEl ? chEl.textContent.trim() : ''
        if (!channel_text) {
          const imgs = Array.from(card.querySelectorAll('img'))
          channel_text = imgs.map(i => ((i.alt || '') + ' ' + (i.src || '')).toLowerCase()).join(' ')
        }
        
        let delivery_type = null
        const fullTxt = card.innerText || ''
        if (fullTxt) {
          const lower = fullTxt.toLowerCase()
          if (lower.includes('구매평') || lower.includes('구매형')) delivery_type = '구매평'
          else if (lower.includes('기자단') || lower.includes('재택')) delivery_type = '재택형'
          else if (lower.includes('배송') || lower.includes('택배')) delivery_type = '배송형'
          else if (lower.includes('방문') || lower.includes('매장') || lower.includes('현장')) delivery_type = '방문형'
        }
        
        return { deadline_text, applicants, capacity, channel_text, delivery_type }
      }

      document.querySelectorAll('a[href]').forEach(el => {
        const href = el.href
        if (!isCampaignHref(href)) return
        if (seen.has(href)) return
        seen.add(href)

        let title = ''
        const cands = el.querySelectorAll('h1,h2,h3,h4,strong,b,[class*="title"],[class*="name"],[class*="subject"],[class*="camp"]')
        for (const t of cands) {
          const txt = t.textContent.replace(/\s+/g, ' ').trim()
          if (txt.length >= 3 && txt.length <= 150) { title = txt; break }
        }
        if (!title) {
          const parent = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"]')
          if (parent) {
            const pc = parent.querySelectorAll('h1,h2,h3,h4,strong,[class*="title"],[class*="name"]')
            for (const t of pc) {
              const txt = t.textContent.replace(/\s+/g, ' ').trim()
              if (txt.length >= 3 && txt.length <= 150) { title = txt; break }
            }
          }
        }
        if (!title) title = el.innerText.replace(/\s+/g, ' ').trim()
        if (!title || title.length < 3 || title.length > 200) return
        const card = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"]')
        
        if (card) {
          const cardText = card.innerText || ''
          const bracketMatches = [...cardText.matchAll(/\[([\uac00-\ud7a30-9a-zA-Z\s\+\&]+)\]/g)]
          const regionBrackets = bracketMatches.filter(m => {
            const inner = m[1].trim()
            if (inner.length > 20) return false
            if (/^(NEW|BEST|D-\d+|\d+)$/i.test(inner)) return false
            return true
          })
          if (regionBrackets.length > 0 && !title.includes('[')) {
            const bracketStr = regionBrackets.map(m => `[${m[1].trim()}]`).join(' ')
            title = bracketStr + ' ' + title
          } else if (regionBrackets.length > 0 && title.startsWith('[')) {
            const titleBrackets = [...title.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim())
            const extraBrackets = regionBrackets.filter(m => !titleBrackets.includes(m[1].trim()))
            if (extraBrackets.length > 0) {
              const extraStr = extraBrackets.map(m => `[${m[1].trim()}]`).join(' ')
              title = extraStr + ' ' + title
            }
          }
        }
        
        results.push({ title, campaign_url: href, ...extractCardMeta(card) })
      })
      return results
    }, {originStr: origin, navWords: ['login','logout','signup','register','about','contact','faq',
      'terms','policy','pricing','help','support','mypage','profile','notice',
      'category','categories','tag','tags','search','keyword','filter']})

    function detectCh(text) {
      const t = (text || '').toLowerCase()
      if (t.includes('릴스') || t.includes('reels')) return '릴스'
      if (t.includes('클립')) return '클립'
      if (t.includes('인스타') || t.includes('instagram')) return '인스타'
      if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
      if (t.includes('틱톡') || t.includes('tiktok')) return '틱톡'
      return null
    }
    return items.map(r => ({
      ...r,
      campaign_type: opts.campaignType || detectCh((r.channel_text || '') + ' ' + r.title) || null,
    }))
  } catch (err) {
    console.warn(`[PW 휴리스틱] ${url} 실패: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}
