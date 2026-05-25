// 클라우드리뷰 중복 캠페인 DB 정리 스크립트
// 실행: $env:SUPABASE_SERVICE_ROLE_KEY="your_key" ; node scripts/crawler/dedup-cloudreview.mjs
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://krmlhcsnpswxavxcskvq.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다')
  console.error('   PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="your_key" ; node scripts/crawler/dedup-cloudreview.mjs')
  console.error('   Supabase 대시보드 → Settings → API → service_role key 복사')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function main() {
  console.log('클라우드리뷰 중복 캠페인 정리 시작...')

  // 클라우드리뷰 전체 캠페인 로드 (crawled_at 오래된 것 먼저)
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, title, campaign_url, crawled_at')
    .eq('platform_name', '클라우드리뷰')
    .order('crawled_at', { ascending: true })

  if (error) {
    console.error('데이터 로드 실패:', error.message)
    return
  }

  console.log(`클라우드리뷰 총 ${campaigns.length}개 검사 중...`)

  const seenUrls = new Map()   // url → id (최초 등록된 것 보존)
  const seenTitles = new Map() // title → id
  const toDelete = []

  for (const c of campaigns) {
    const url = c.campaign_url
    const title = (c.title || '').trim()

    let isDup = false

    if (seenUrls.has(url)) {
      isDup = true
    } else if (title && seenTitles.has(title)) {
      isDup = true
    }

    if (isDup) {
      toDelete.push(c.id)
    } else {
      seenUrls.set(url, c.id)
      if (title) seenTitles.set(title, c.id)
    }
  }

  console.log(`삭제 대상: ${toDelete.length}개 중복 캠페인`)

  if (toDelete.length === 0) {
    console.log('중복 없음!')
    return
  }

  // 50개씩 나눠서 삭제
  const CHUNK = 50
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK)
    const { error: delErr } = await supabase
      .from('campaigns')
      .delete()
      .in('id', chunk)

    if (delErr) {
      console.error('삭제 실패:', delErr.message)
    } else {
      deleted += chunk.length
      console.log(`  ${deleted}/${toDelete.length}개 삭제 완료...`)
    }
  }

  console.log(`\n완료! 클라우드리뷰 중복 ${deleted}개 삭제됨.`)
}

main().catch(console.error)
