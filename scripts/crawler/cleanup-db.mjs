import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { detectDelivery } from './utils.mjs'

// .env 로드 (로컬 실행 시 필요)
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// utils.mjs의 sanitizeTitle과 동일한 로직 복사 (로컬 스크립트 실행용)
const sanitizeTitle = (raw) => raw
  .replace(/^(Layer\s*1\s*s|Layer1s)\s*/i, '')
  .replace(/\[\s*(NEW|BEST|마감임박|신청폭주|단독진행|긴급모집|추천|인기|HOT)\s*\]/gi, '')
  .replace(/<\s*(블로그|인스타|유튜브|릴스|클립|틱톡|체험단|기자단)\s*>/gi, '')
  .replace(/\d{4}[.\/-]\d{2}[.\/-]\d{2}(\s*\d{2}:\d{2}(:\d{2})?)?/g, '')
  .replace(/\(?\s*신청\s*[\d,]+\s*\/\s*[\d,]+\s*명?\s*\)?/g, '')
  .replace(/D-Day\s*신청\s*[\d,]+\s*명\s*\//gi, '')
  .replace(/신청\s*[\d,]+\s*명\s*\/?/g, '')
  .replace(/\d+\s*일\s*남음/g, '')
  .replace(/\[\s*D-\d+\s*\]/gi, '')
  .replace(/D-Day/gi, '')
  .replace(/D-\d+/gi, '')
  .replace(/\s*오늘\s*마감/g, '')
  .replace(/\d+\s*(시간|분|초)\s*전/g, '')
  .replace(/\d+\s*명\s*(모집|신청|선정)/g, '')
  .replace(/모집\s*\d+\s*명/g, '')
  .replace(/^(Blog|SNS)\s+(배송형|방문형|재택형|구매평형|체험단)\s*/i, '')
  .replace(/^(매장방문형|배송형|구매형|방문형|재택형|구매평형|기자단형)\s*/g, '')
  .replace(/제공\s*포인트[:\s]*[\d]*\s*[A-Za-z]{0,4}/gi, '')
  .replace(/\b\d+\s*PD\b/gi, '')
  .replace(/\s*[-–]\s*day\s*$/i, '')
  .replace(/\[\s*\]/g, '')
  .replace(/\/\s*$/g, '')
  .replace(/\s+/g, ' ')
  .trim()

async function main() {
  console.log('기존 캠페인 데이터 정제 시작...')
  
  // 전체 캠페인 로드
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*')

  if (error) {
    console.error('데이터 로드 실패:', error.message)
    return
  }
  
  console.log(`총 ${campaigns.length}개의 캠페인을 검사합니다.`)
  
  let updatedCount = 0;
  for (const c of campaigns) {
    const newTitle = sanitizeTitle(c.title).substring(0, 200)
    
    // 기존에 잘못 분류되었을 수 있는 delivery_type 재평가
    // 단, 과거 데이터는 카드 원문 텍스트가 없으므로 타이틀 기반으로만 판단
    const rawForDetect = newTitle + ' ' + (c.campaign_type || '')
    let newDeliveryType = c.delivery_type
    
    // 만약 기존에 배송형으로 되어 있는데, 지역명이 있다면 방문형으로 교정
    const autoDetected = detectDelivery(rawForDetect)
    if (autoDetected === '방문형' && c.delivery_type === '배송형') {
      newDeliveryType = '방문형'
    }

    if (newTitle !== c.title || newDeliveryType !== c.delivery_type) {
      const { error: updateError } = await supabase
        .from('campaigns')
        .update({ 
          title: newTitle, 
          delivery_type: newDeliveryType 
        })
        .eq('id', c.id)

      if (updateError) {
        console.error(`업데이트 실패 [ID: ${c.id}]:`, updateError.message)
      } else {
        updatedCount++
      }
    }
  }

  console.log(`\n작업 완료! 총 ${updatedCount}개의 캠페인이 수정되었습니다.`)
}

main().catch(console.error)
