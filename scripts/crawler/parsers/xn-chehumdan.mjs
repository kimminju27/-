// 체험단모집 — campaign.php?cp_id= (storyn 패턴)
import { parseCpId } from './storyn.mjs'
export async function parse(baseUrl) {
  return parseCpId(baseUrl, '체험단모집', 'campaign.php?cp_id=')
}
