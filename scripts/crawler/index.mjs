// 크롤러 진입점 — GitHub Actions에서 실행
import { createClient } from '@supabase/supabase-js'
import { upsertCampaigns, deactivateOldCampaigns } from './utils.mjs'

// 파서 목록 (사이트별 파서 동적 import)
import { parse as parseNaverBlog } from './parsers/naver-blog.mjs'
import { parse as parseReviewshare } from './parsers/reviewshare.mjs'
import { parse as parseRevu } from './parsers/revu.mjs'
import { parse as parseChehumdan } from './parsers/chehumdan.mjs'
import { parse as parseReviewnote } from './parsers/reviewnote.mjs'
import { parse as parseMrblog } from './parsers/mrblog.mjs'
import { parse as parseDinnerqueen } from './parsers/dinnerqueen.mjs'
import { parse as parseAssaview } from './parsers/assaview.mjs'
import { parse as parseRealreview } from './parsers/real-review.mjs'
import { parse as parseTojob } from './parsers/tojob.mjs'
import { parse as parseTble } from './parsers/tble.mjs'
import { parse as parseRingble } from './parsers/ringble.mjs'
import { parse as parseCloudreview } from './parsers/cloudreview.mjs'
import { parse as parseSeoulouba } from './parsers/seoulouba.mjs'
import { parse as parseWereview } from './parsers/wereview.mjs'
import { parse as parseBlogchehumdan } from './parsers/blogchehumdan.mjs'
import { parse as parseStoryn } from './parsers/storyn.mjs'
import { parse as parseModan } from './parsers/modan.mjs'
import { parse as parseChvu } from './parsers/chvu.mjs'
import { parse as parse4blog } from './parsers/4blog.mjs'
import { parse as parseDengdeng } from './parsers/dengdeng.mjs'
import { parse as parseTagby } from './parsers/tagby.mjs'
import { parse as parseReviewjin } from './parsers/reviewjin.mjs'
import { parse as parseFromblog } from './parsers/fromblog.mjs'
import { parse as parseReviewplace } from './parsers/reviewplace.mjs'
import { parse as parseRemin } from './parsers/remin.mjs'
import { parse as parseBloglab } from './parsers/bloglab.mjs'
import { parse as parseMetachehumdan } from './parsers/meta-chehumdan.mjs'
import { parse as parseOhmyblog } from './parsers/ohmyblog.mjs'
import { parse as parseCometoplay } from './parsers/cometoplay.mjs'
import { parse as parseCashnote } from './parsers/cashnote.mjs'
import { parse as parsePavlovu } from './parsers/pavlovu.mjs'
import { parse as parseReviewting } from './parsers/reviewting.mjs'
import { parse as parseXnChehumdan } from './parsers/xn-chehumdan.mjs'
import { parse as parseXnChehumdan2 } from './parsers/xn-chehumdan2.mjs'
import { parse as parseXnBlogchehumdan } from './parsers/xn-blogchehumdan.mjs'
import { parse as parseXnReviewmoeum } from './parsers/xn-reviewmoeum.mjs'

// 플랫폼명 → 파서 함수 매핑
const PARSERS = {
  '어포스푼':        { fn: parseNaverBlog,    url: 'https://rss.blog.naver.com/aspooncj.xml' },
  '원더블':          { fn: parseNaverBlog,    url: 'https://rss.blog.naver.com/wonderble.xml' },
  '미스터블로그':    { fn: parseMrblog,       url: 'https://www.mrblog.net/' },
  '다이닝퀸':        { fn: parseDinnerqueen,  url: 'https://dinnerqueen.net/' },
  '아싸뷰':          { fn: parseAssaview,     url: 'https://assaview.co.kr/' },
  '리뷰노트':        { fn: parseReviewnote,   url: 'https://www.reviewnote.co.kr/' },
  '리얼리뷰':        { fn: parseRealreview,   url: 'https://www.real-review.kr/' },
  '토잡':            { fn: parseTojob,        url: 'https://www.tojobcn.com/' },
  '블로그체험단':    { fn: parseBlogchehumdan,url: 'https://xn--939au0g4vj8sq.net/' },
  '테이블':          { fn: parseTble,         url: 'https://www.tble.kr/' },
  '링블':            { fn: parseRingble,      url: 'https://www.ringble.co.kr/index_mobile.php' },
  '클라우드리뷰':    { fn: parseCloudreview,  url: 'https://cloudreview.co.kr/' },
  '서울오빠':        { fn: parseSeoulouba,    url: 'https://www.seoulouba.co.kr/' },
  '위리뷰':          { fn: parseWereview,     url: 'https://www.wereview.fun/' },
  '블로그체험':      { fn: parseXnBlogchehumdan, url: 'https://xn--5y2bw0fi0u.kr/' },
  '리뷰쉐어':        { fn: parseReviewshare,  url: 'https://reviewshare.io/' },
  '체험단':          { fn: parseChehumdan,    url: 'https://chehumdan.com/' },
  '컴투플레이':      { fn: parseCometoplay,   url: 'https://www.cometoplay.kr/index.php' },
  '스토리엔':        { fn: parseStoryn,       url: 'https://storyn.kr/index.php' },
  '모단':            { fn: parseModan,        url: 'https://www.modan.kr/' },
  '체뷰':            { fn: parseChvu,         url: 'https://chvu.co.kr/' },
  '포블로그':        { fn: parse4blog,        url: 'https://4blog.net/' },
  '캐시노트인플루언서': { fn: parseCashnote,  url: 'https://place.cashnote.kr/influence' },
  '덩덩뷰':          { fn: parseDengdeng,     url: 'https://www.dengdengview.co.kr/index.php' },
  '태그바이':        { fn: parseTagby,        url: 'https://tagby.io/' },
  '레뷰':            { fn: parseRevu,         url: 'https://www.revu.net/' },
  '체험단모음':      { fn: parseXnReviewmoeum,url: 'https://xn--o39a04kpnjo4k9hgflp.com/' },
  '파블로뷰':        { fn: parsePavlovu,      url: 'https://pavlovu.com/index.php' },
  '리뷰팅':          { fn: parseReviewting,   url: 'https://www.reviewting.net/index.php' },
  '체험단모집':      { fn: parseXnChehumdan,  url: 'https://xn--vk1bn0kvydxrlprb.com/' },
  '리뷰진':          { fn: parseReviewjin,    url: 'https://reviewjin.com/' },
  '프롬블로그':      { fn: parseFromblog,     url: 'https://www.from-blog.com/' },
  '리뷰플레이스':    { fn: parseReviewplace,  url: 'https://www.reviewplace.co.kr/' },
  '리민':            { fn: parseRemin,        url: 'https://remin.co.kr/' },
  '블로그랩':        { fn: parseBloglab,      url: 'https://bloglab.kr/index.php' },
  '메타체험단':      { fn: parseMetachehumdan,url: 'https://meta-chehumdan.com/index.php' },
  '오마이블로그':    { fn: parseOhmyblog,     url: 'https://www.ohmyblog.co.kr/' },
  '체험단XN2':       { fn: parseXnChehumdan2, url: 'https://xn--vk1bn0kvydxrlprb.com/' },
}

// Supabase 클라이언트 (service_role 키 사용)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TARGET = process.env.TARGET_PLATFORM || ''

async function main() {
  console.log(`[크롤러 시작] ${new Date().toISOString()}`)
  console.log(`대상: ${TARGET || '전체'}`)

  // 활성 플랫폼 목록 로드
  const { data: platforms, error } = await supabase
    .from('platforms')
    .select('*')
    .eq('is_active', true)

  if (error) {
    console.error('플랫폼 로드 실패:', error.message)
    process.exit(1)
  }

  const targets = TARGET
    ? platforms.filter(p => p.name === TARGET)
    : platforms

  console.log(`처리 플랫폼: ${targets.length}개`)

  let totalInserted = 0
  let totalErrors = 0

  // 순차 처리 (서버 부하 분산, 1초 간격)
  for (const platform of targets) {
    const parser = PARSERS[platform.name]
    if (!parser) {
      console.warn(`[${platform.name}] 파서 없음 — 건너뜀`)
      continue
    }

    try {
      console.log(`[${platform.name}] 크롤링 시작...`)
      const crawlStart = new Date().toISOString()
      const campaigns = await parser.fn(parser.url)

      if (campaigns.length > 0) {
        const { inserted } = await upsertCampaigns(
          supabase, platform.name, platform.id, campaigns
        )

        // 이번 크롤 전에 수집된 캠페인 비활성화 (= 모집마감으로 목록에서 사라진 것)
        await deactivateOldCampaigns(supabase, platform.name, crawlStart)

        // last_crawled_at 업데이트
        await supabase
          .from('platforms')
          .update({ last_crawled_at: new Date().toISOString() })
          .eq('id', platform.id)

        console.log(`[${platform.name}] 완료: ${inserted}개 갱신, 총 ${campaigns.length}개 수집`)
        totalInserted += inserted
      } else {
        console.log(`[${platform.name}] 수집 결과 없음 — 비활성화 생략`)
      }
    } catch (err) {
      console.error(`[${platform.name}] 실패:`, err.message)
      totalErrors++
    }

    // 요청 간 딜레이
    await new Promise(r => setTimeout(r, 1000))
  }

  // 오래된 캠페인 정리 (30일 이상)
  const { error: cleanErr } = await supabase
    .from('campaigns')
    .delete()
    .lt('crawled_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  if (cleanErr) console.warn('정리 실패:', cleanErr.message)
  else console.log('[정리] 30일 이상 캠페인 삭제 완료')

  console.log(`\n[크롤러 완료] 신규: ${totalInserted}개, 실패: ${totalErrors}개`)
}

main().catch(err => {
  console.error('치명적 오류:', err)
  process.exit(1)
})
