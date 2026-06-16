// 포블로그 — /project/[slug]/ 패턴, 인피니티 스크롤
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/project/', { extraWaitMs: 4000, scrollCount: 8, scrollWaitMs: 1500 })
}
