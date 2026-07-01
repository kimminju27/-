// 클라우드리뷰 — Playwright, /campaign/detail/ 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  const items = await playwrightParse(baseUrl, '/campaign/detail/', { extraWaitMs: 6000, scrollCount: 15, scrollWaitMs: 1500 })
  // URL 기준 중복 제거 (같은 캠페인에 <a> 태그가 여러 개인 경우 방지)
  const seenUrls = new Set()
  const seenTitles = new Set()
  return items.filter(c => {
    const urlKey = c.campaign_url
    const titleKey = (c.title || '').trim()
    if (seenUrls.has(urlKey)) return false
    if (titleKey && seenTitles.has(titleKey)) return false
    seenUrls.add(urlKey)
    if (titleKey) seenTitles.add(titleKey)
    return true
  })
}
