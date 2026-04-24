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
        // 신청인원
        const apEl = card.querySelector(
          '[class*="apply"],[class*="applicant"],[class*="count"],[class*="people"],[class*="participant"],[class*="join"]'
        )
        const applicants = apEl ? (parseInt(apEl.textContent.replace(/[^0-9]/g,'')) || 0) : 0
        // 모집인원
        const capEl = card.querySelector(
          '[class*="limit"],[class*="capacity"],[class*="quota"],[class*="max"],[class*="total"],[class*="recruit"]'
        )
        const capacity = capEl ? (parseInt(capEl.textContent.replace(/[^0-9]/g,'')) || null) : null
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
        return { deadline_text, applicants, capacity, channel_text }
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
              if (txt.length >= 5 && txt.length <= 150) { title = txt; break }
            }
          }
        }
        if (!title || title.length < 5 || title.length > 200) return
        seen.add(href)
        const card = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"],tr')
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
        const applicants = apEl ? (parseInt(apEl.textContent.replace(/[^0-9]/g,'')) || 0) : 0
        const capEl = card.querySelector(
          '[class*="limit"],[class*="capacity"],[class*="quota"],[class*="max"],[class*="total"],[class*="recruit"]'
        )
        const capacity = capEl ? (parseInt(capEl.textContent.replace(/[^0-9]/g,'')) || null) : null
        const chEl = card.querySelector(
          '[class*="channel"],[class*="media"],[class*="badge"],[class*="sns"],[class*="platform"],[class*="tag"],[class*="kind"],[class*="type"],[class*="category"]'
        )
        let channel_text = chEl ? chEl.textContent.trim() : ''
        if (!channel_text) {
          const imgs = Array.from(card.querySelectorAll('img'))
          channel_text = imgs.map(i => ((i.alt || '') + ' ' + (i.src || '')).toLowerCase()).join(' ')
        }
        return { deadline_text, applicants, capacity, channel_text }
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
          if (txt.length >= 5 && txt.length <= 150) { title = txt; break }
        }
        if (!title) {
          const parent = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"]')
          if (parent) {
            const pc = parent.querySelectorAll('h1,h2,h3,h4,strong,[class*="title"],[class*="name"]')
            for (const t of pc) {
              const txt = t.textContent.replace(/\s+/g, ' ').trim()
              if (txt.length >= 5 && txt.length <= 150) { title = txt; break }
            }
          }
        }
        if (!title) title = el.innerText.replace(/\s+/g, ' ').trim()
        if (!title || title.length < 5 || title.length > 200) return
        const card = el.closest('li,article,div[class*="item"],div[class*="card"],div[class*="list"]')
        results.push({ title, campaign_url: href, ...extractCardMeta(card) })
      })
      return results
    }, {originStr: origin, navWords: ['login','logout','signup','register','about','contact','faq',
      'terms','policy','pricing','help','support','mypage','profile','notice']})

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
