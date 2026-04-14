// 파블로뷰 — review_campaign.php?cp_id= (storyn과 동일 구조)
import { parseCpId } from './storyn.mjs'
export async function parse(baseUrl) {
  return parseCpId(baseUrl, '파블로뷰', 'review_campaign.php?cp_id=')
}
