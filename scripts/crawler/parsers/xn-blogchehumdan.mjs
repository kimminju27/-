// 블로그체험 (xn--5y2bw0fi0u.kr) — cv_campaign.php?cp_id= (storyn 패턴)
import { parseCpId } from './storyn.mjs'
export async function parse(baseUrl) {
  return parseCpId(baseUrl, '블로그체험', 'cv_campaign.php?cp_id=')
}
