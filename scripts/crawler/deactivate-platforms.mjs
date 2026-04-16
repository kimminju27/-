// 비활성화: SPA/AJAX/fetch실패 플랫폼 is_active = false
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DEACTIVATE = [
  // SPA (React/Next.js/Vue — cheerio 불가)
  '레뷰', '리뷰쉐어', '체뷰', '오마이블로그', '캐시노트인플루언서', '모단',
  '위리뷰',     // React+Mantine SPA
  '태그바이',   // Nuxt.js SPA
  '리뷰진',     // 콘텐츠 미노출 SPA 추정
  // SSL/fetch 실패
  '티블',       // 오래된 SSL 설정
  // AJAX 동적 로드 (cheerio 불가)
  '4블로그',    // jQuery AJAX 무한스크롤
  '체험단모음', // AJAX 방식
  '리뷰의민족', // JS onClick 링크
  // 일반 포스팅 섞임
  '어포스푼', '원더블',
]

async function main() {
  console.log('비활성화 대상:', DEACTIVATE.join(', '))

  // 플랫폼 비활성화
  const { data, error } = await supabase
    .from('platforms')
    .update({ is_active: false })
    .in('name', DEACTIVATE)
    .select('name, is_active')

  if (error) {
    console.error('플랫폼 업데이트 실패:', error.message)
    process.exit(1)
  }
  console.log('비활성화 완료:', data?.map(p => p.name).join(', ') || '(없음)')

  // 해당 플랫폼 캠페인 데이터 정리
  const { count, error: delErr } = await supabase
    .from('campaigns')
    .delete({ count: 'exact' })
    .in('platform_name', DEACTIVATE)

  if (delErr) console.warn('캠페인 삭제 실패:', delErr.message)
  else console.log(`캠페인 정리 완료: ${count}개 삭제`)
}

main().catch(err => {
  console.error('오류:', err)
  process.exit(1)
})
