// 미블 — SPA (AJAX), Playwright + /campaigns/숫자 패턴
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(`${baseUrl}campaigns`, '/campaigns/', { extraWaitMs: 3000 })
}
