// 오마이블로그 — Vue SPA, /productDetail.apsl?app_seq= 패턴
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  return playwrightParse(baseUrl, '/productDetail.apsl', {
    extraWaitMs: 4000, scrollCount: 15, scrollWaitMs: 1500,
  })
}
