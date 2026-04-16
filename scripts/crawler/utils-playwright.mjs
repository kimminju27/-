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
export async function playwrightParse(url, hrefKeyword, opts = {}) {
  const br = await getBrowser()
  const page = await br.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 12000 }).catch(() => {})
    }
    if (opts.extraWaitMs) await page.waitForTimeout(opts.extraWaitMs)

    const items = await page.evaluate((keyword, titleSel) => {
      const results = [], seen = new Set()
      document.querySelectorAll('a[href]').forEach(el => {
        const href = el.href
        if (!href.includes(keyword)) return
        if (seen.has(href)) return
        seen.add(href)
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
        if (!title || title.length < 5 || title.length > 200) return
        results.push({ title, campaign_url: href })
      })
      return results
    }, hrefKeyword, opts.titleSelector || '')

    return items.map(r => ({
      ...r,
      campaign_type: opts.campaignType || '블로그',
      applicants: 0, capacity: null, deadline_text: null,
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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 12000 }).catch(() => {})
    }
    if (opts.extraWaitMs) await page.waitForTimeout(opts.extraWaitMs)

    const origin = new URL(url).origin
    const items = await page.evaluate((originStr, navWords) => {
      const results = [], seen = new Set()

      function isCampaignHref(href) {
        try {
          const u = new URL(href)
          if (u.origin !== originStr) return false
          const parts = u.pathname.split('/').filter(Boolean)
          if (parts.length < 2) return false
          const hasNum = /\d{3,}/.test(u.pathname)
          const hasSlug = /[a-zA-Z0-9가-힣-]{6,}/.test(parts[parts.length-1])
          if (!hasNum && !hasSlug) return false
          if (navWords.some(w => u.pathname.toLowerCase().includes(w))) return false
          return true
        } catch { return false }
      }

      document.querySelectorAll('a[href]').forEach(el => {
        const href = el.href
        if (!isCampaignHref(href)) return
        if (seen.has(href)) return
        seen.add(href)

        let title = ''
        // 링크 내부
        const cands = el.querySelectorAll('h1,h2,h3,h4,strong,b,[class*="title"],[class*="name"],[class*="subject"],[class*="camp"]')
        for (const t of cands) {
          const txt = t.textContent.replace(/\s+/g, ' ').trim()
          if (txt.length >= 5 && txt.length <= 150) { title = txt; break }
        }
        // 부모에서 탐색
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
        results.push({ title, campaign_url: href })
      })
      return results
    }, origin, ['login','logout','signup','register','about','contact','faq',
      'terms','policy','pricing','help','support','mypage','profile','notice'])

    return items.map(r => ({
      ...r,
      campaign_type: opts.campaignType || '블로그',
      applicants: 0, capacity: null, deadline_text: null,
    }))
  } catch (err) {
    console.warn(`[PW 휴리스틱] ${url} 실패: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}
