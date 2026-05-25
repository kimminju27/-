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
  if (!t || t.length < 5 || t.length > 150) return false
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

    const items = await page.evaluate(({keyword, titleSel}) => {
      function extractCardMeta(card) {
        if (!card) return { deadline_text: null, applicants: 0, capacity: null, channel_text: '' }
        // 마감일
        const ddEl = card.querySelector(
          '[class*="dday"],[class*="d-day"],[class*="remain"],[class*="deadline"],[class*="expire"],[class*="due"],[class*="period"],[class*="date"],[class*="day"],[class*="end"]'
        )
        const deadline_text = ddEl ? ddEl.textContent.trim().slice(0, 30) : null
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
        const capSlash = capRaw.match(/[\/|]\s*(\d+)/)
        const capacity = capEl ? (capSlash ? parseInt(capSlash[1]) : (parseInt(capRaw.replace(/[^0-9]/g,'')) || null)) : null
        // 채널 타입 뱃지 (인스타/유튜브/릴스 등)
        const chEl = card.querySelector(
          '[class*="channel"],[class*="media"],[class*="badge"],[class*="sns"],[class*="platform"],[class*="tag"],[class*="kind"],[class*="type"],[class*="category"]'
        )
        let channel_text = chEl ? chEl.textContent.trim() : ''
        if (!channel_text) {
          // 텍스트 없으면 이미지 alt/src로 채널 감지 (아이콘 전용 사이트 대응)
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
          const t = el.querySelector(titleSel) ||
            el.closest('li,article,div[class*="item"],div[class*="card"]')?.querySelector(titleSel)
          if (t) title = t.textContent.trim()
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
          '[class*="dday"],[class*="d-day"],[class*="remain"],[class*="deadline"],[class*="expire"],[class*="due"],[class*="period"],[class*="date"],[class*="day"],[class*="end"]'
        )
        const deadline_text = ddEl ? ddEl.textContent.trim().slice(0, 30) : null
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
