// 4블로그 (4blog.net) — AJAX 로드, Playwright로 /campaign/{id}/ 패턴 추출
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaign/', { extraWaitMs: 3000 })
}
