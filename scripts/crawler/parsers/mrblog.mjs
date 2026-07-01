// 미블 — SPA 인피니티 스크롤, 자동 스크롤로 전체 로드
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaigns/', {
    extraWaitMs: 6000,
    scrollCount: 20,      // 최대 20번 스크롤
    scrollWaitMs: 2000,   // 스크롤당 2초 대기
  })
}
