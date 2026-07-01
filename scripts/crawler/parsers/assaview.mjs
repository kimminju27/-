// 아싸뷰 — JS 클릭 이벤트 방식, Playwright 휴리스틱
// 아싸뷰 타임(선착순 시간제 이벤트)은 "선착순 이벤트"로 통합
import { playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  const items = await playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000, scrollCount: 15, scrollWaitMs: 1500 })
  const seen = new Set()
  return items
    .map(c => {
      // "아싸뷰 타임 HH:MM:SS" → 고정 제목으로 통합
      if (/아싸뷰\s*타임\s*\d{1,2}:\d{2}/i.test(c.title)) {
        return { ...c, title: '아싸뷰 선착순 구매평 이벤트', delivery_type: '구매평' }
      }
      return c
    })
    .filter(c => {
      if (seen.has(c.title)) return false
      seen.add(c.title)
      return true
    })
}
