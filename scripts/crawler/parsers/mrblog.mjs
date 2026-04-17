// 미블 — SPA, 루트에서 로드 후 /campaigns/숫자 패턴 추출
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/campaigns/', { extraWaitMs: 8000 })
}
