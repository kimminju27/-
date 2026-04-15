// 오염 데이터 삭제 스크립트
// 실행: SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/cleanup-bad-data.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://krmlhcsnpswxavxcskvq.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다')
  console.error('   Supabase 대시보드 → Settings → API → service_role key')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function cleanup() {
  console.log('🧹 오염 데이터 정리 시작...\n')

  // 1. 아싸뷰: 날짜 형식(YYYY/MM/DD) 으로 시작하는 제목 삭제
  console.log('[1/2] 아싸뷰 날짜형 제목 삭제...')
  const { data: assaData, error: assaErr } = await supabase
    .from('campaigns')
    .delete()
    .eq('platform_name', '아싸뷰')
    .like('title', '____/__/__%')
    .select('title')

  if (assaErr) {
    console.error('  ❌ 아싸뷰 삭제 실패:', assaErr.message)
  } else {
    console.log(`  ✅ ${assaData.length}개 삭제됨`)
    assaData.slice(0, 3).forEach(r => console.log(`     - ${r.title.slice(0, 60)}`))
  }

  // 2. 다이닝퀸: http:// 또는 https:// 로 시작하는 제목 삭제
  console.log('\n[2/2] 다이닝퀸 URL형 제목 삭제...')
  const { data: dqData, error: dqErr } = await supabase
    .from('campaigns')
    .delete()
    .eq('platform_name', '다이닝퀸')
    .like('title', 'http%')
    .select('title')

  if (dqErr) {
    console.error('  ❌ 다이닝퀸 삭제 실패:', dqErr.message)
  } else {
    console.log(`  ✅ ${dqData.length}개 삭제됨`)
    dqData.slice(0, 3).forEach(r => console.log(`     - ${r.title.slice(0, 60)}`))
  }

  console.log('\n🎉 정리 완료!')
}

cleanup().catch(err => {
  console.error('치명적 오류:', err)
  process.exit(1)
})
