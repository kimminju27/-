// 프롬블로그 — /project/[slug]/ 패턴
// Playwright로 직접 파싱 (봇 차단 대응)
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/project/', { extraWaitMs: 4000 })
}
