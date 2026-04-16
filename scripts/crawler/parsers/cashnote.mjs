// 캐시노트인플루언서 — /influence/campaigns/{id} (확인됨)
import { playwrightParse } from '../utils-playwright.mjs'
export async function parse(baseUrl) {
  return playwrightParse(
    'https://place.cashnote.kr/influence',
    '/influence/campaigns/',
    { extraWaitMs: 2000 }
  )
}
