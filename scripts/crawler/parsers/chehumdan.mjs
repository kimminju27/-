// 체험단(chehumdan.com) — Playwright, detail.php?number= 패턴
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(`${baseUrl}index.php`, 'detail.php?number=', { extraWaitMs: 6000 })
}
