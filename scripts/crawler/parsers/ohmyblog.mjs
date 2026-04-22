// 오마이블로그 — Vue SPA, /user/productDetail?app_seq= 패턴
// 동일 URL 중복 방지: URL 기반 seen → 제목 불일치로 인한 DB 중복 해소
import { playwrightParse, playwrightParseHeuristic } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 1차: URL 패턴 기반 파싱 (중복 방지 목적, URL이 고유 키)
  const r = await playwrightParse(baseUrl, '/user/productDetail?app_seq=', { extraWaitMs: 3000 })
  if (r.length > 0) return r
  // 2차: 패턴 변경 대비 휴리스틱 폴백
  return playwrightParseHeuristic(baseUrl, { extraWaitMs: 3000 })
}
