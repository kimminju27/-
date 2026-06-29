// 크롤러 공통 유틸리티
import crypto from 'crypto'

const BAD_TITLE_PATTERNS = [
  /^(로그인|회원가입|마이페이지|공지사항|더보기|전체보기|신청하기|목록보기|홈|HOME)$/i,
  /^(블로그|인스타|유튜브|틱톡|방문|재택|체험단|캠페인|이벤트|기자단)$/i,
  /^(체험단\s*찾기|캠페인\s*목록|모집중|마감임박|인기|최신|추천)$/i,
  /^[\d\s\.\-\/]+$/,
  /^[^\uAC00-\uD7A3a-zA-Z]+$/,
]

// 이 접두사로 시작하는 캠페인은 수집 제외 (방문기자단, 방문체험 등 불필요 유형)
const BAD_PREFIXES = ['방문기자단', '방문체험']

function isValidTitle(title) {
  if (!title) return false
  const t = title.trim()
  if (t.length < 6 || t.length > 200) return false
  if (BAD_PREFIXES.some(p => t.startsWith(p))) return false
  return !BAD_TITLE_PATTERNS.some(p => p.test(t))
}

export function makeHash(platformName, url) {
  return crypto.createHash('md5').update(`${platformName}::${url}`).digest('hex')
}

/**
 * deadline_text(D-N, N일 남음 등)를 DATE 문자열로 변환
 * 반환: "YYYY-MM-DD" 또는 null
 */
function parseDeadlineDate(text) {
  if (!text) return null
  const dMatch = text.match(/D-(\d+)/i)
  if (dMatch) {
    const d = new Date()
    d.setDate(d.getDate() + parseInt(dMatch[1]))
    return d.toISOString().split('T')[0]
  }
  const dayMatch = text.match(/(\d+)\s*일\s*남음/)
  if (dayMatch) {
    const d = new Date()
    d.setDate(d.getDate() + parseInt(dayMatch[1]))
    return d.toISOString().split('T')[0]
  }
  // "YYYY.MM.DD ~ YYYY.MM.DD" 범위 형식 → 종료일(마감일) 추출
  const rangeMatch = text.match(/\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*[~\-]\s*(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/)
  if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2].padStart(2,'0')}-${rangeMatch[3].padStart(2,'0')}`
  // "YY.MM.DD~YY.MM.DD일" 2자리 연도 범위 → 종료일 추출 (e.g. 26.04.21~26.04.26일)
  const shortRangeMatch = text.match(/\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*[~\-]\s*(\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/)
  if (shortRangeMatch) return `20${shortRangeMatch[1]}-${shortRangeMatch[2].padStart(2,'0')}-${shortRangeMatch[3].padStart(2,'0')}`
  // 단일 YYYY-MM-DD 또는 YYYY.MM.DD
  const dateMatch = text.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/)
  if (dateMatch) return `${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`
  // 단일 YY.MM.DD (2자리 연도)
  const shortDateMatch = text.match(/^(\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/)
  if (shortDateMatch) return `20${shortDateMatch[1]}-${shortDateMatch[2].padStart(2,'0')}-${shortDateMatch[3].padStart(2,'0')}`
  return null
}

/**
 * 캠페인 upsert — ignoreDuplicates:true
 * crawled_at = 최초 삽입 시각 (이후 변경 안 됨)
 * → "오늘 신규" = crawled_at >= today 로 판별 가능
 */
export async function upsertCampaigns(wpUrl, platformName, platformId, campaigns) {
  if (!campaigns || campaigns.length === 0) return { inserted: 0, skipped: 0 }

  const now = new Date().toISOString()

  // 모든 파서 공통 제목 정제 (신청수·날짜·타입접두 제거)
  const sanitizeTitle = (raw) => raw
    .replace(/^\s*(Layer\s*1\s*s|Layer1s)\s*/i, '')
    .replace(/\[\s*(NEW|BEST|마감임박|신청폭주|단독진행|긴급모집|추천|인기|HOT)\s*\]/gi, '')
    .replace(/<\s*(블로그|인스타|유튜브|릴스|클립|틱톡|체험단|기자단)\s*>/gi, '')
    // [인스타+쿠팡구매평], [블로그+방문형] 등 채널+방식 복합 접두어 제거
    .replace(/^\[\s*(블로그|인스타|인스타그램|유튜브|릴스|클립|틱톡)\s*[+&]\s*[^\]]{1,30}\s*\]\s*/gi, '')
    // [블로그], [인스타] 등 채널 단독 접두어 제거 (지역명이 아닌 것만)
    .replace(/^\[\s*(블로그|인스타|인스타그램|유튜브|릴스|클립|틱톡|체험단|기자단)\s*\]\s*/gi, '')
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

  const seenHashes = new Set()
  const rows = campaigns
    .filter(c => c.title && c.campaign_url && isValidTitle(c.title))
    .map(c => {
      // delivery_type: 파서가 명시하면 우선, 없으면 제목+파서값에서 감지
      // 단, 제목에서 먼저 복합 패턴([인스타+쿠팡구매평] 등) 추출
      const rawForDetect = c.title + ' ' + (c.campaign_type || '')
      const deliveryType = c.delivery_type || detectDelivery(rawForDetect)

      // channel: 파서 값이 유효 채널 타입일 때만 사용, 그 외(방문·배송 등)는 제목에서 재감지
      const VALID_CHANNELS = ['블로그', '인스타', '릴스', '유튜브', '클립', '틱톡']
      const channelType = (c.campaign_type && VALID_CHANNELS.includes(c.campaign_type))
        ? c.campaign_type
        : detectChannel(c.title)

      return {
        platform_id: platformId || null,
        platform_name: platformName,
        title: sanitizeTitle(c.title).substring(0, 200),
        campaign_url: c.campaign_url,
        campaign_type: channelType,
        delivery_type: deliveryType,
        applicants: parseInt(c.applicants) || 0,
        capacity: parseInt(c.capacity) || null,
        deadline_text: c.deadline_text || null,
        deadline_date: parseDeadlineDate(c.deadline_text),
        content_hash: makeHash(platformName, c.campaign_url),
        is_active: true,
      }
    })
    .filter(r => {
      if (seenHashes.has(r.content_hash)) return false
      seenHashes.add(r.content_hash)
      return true
    })

  if (rows.length === 0) return { inserted: 0, skipped: 0 }

  const token = process.env.WP_SYNC_TOKEN || 'camradar-secret-sync-token-2026';
  const ajaxUrl = `${wpUrl}/wp-admin/admin-ajax.php`;
  const BATCH_SIZE = 40;

  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const formBody = new URLSearchParams({
      action: 'camradar_sync',
      token,
      campaigns_json: JSON.stringify({ campaigns: batch }),
    });

    let ok = false;
    try {
      const response = await fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const data = await response.json();
      const result = data.data || data;
      if (result.inserted !== undefined) {
        totalInserted += result.inserted;
        ok = true;
      }
    } catch (error) {
      console.error(`[${platformName}] 싱크 오류 (ajax): ${error.message}`);
    }

    if (!ok) {
      // REST API 폴백
      try {
        const restUrl = `${wpUrl}/wp-json/camradar/v1/sync-campaigns`;
        const response2 = await fetch(restUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CamRadar-Token': token,
          },
          body: JSON.stringify({ campaigns: batch }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response2.ok) throw new Error(`HTTP Error: ${response2.status}`);
        const data2 = await response2.json();
        if (data2.inserted !== undefined) totalInserted += data2.inserted;
      } catch (error2) {
        console.error(`[${platformName}] 싱크 오류 (rest): ${error2.message}`);
      }
    }

    // Vultr 체험단레이더로도 전송
    const vultrUrl = process.env.VULTR_URL;
    const vultrToken = process.env.VULTR_SYNC_TOKEN;
    if (vultrUrl && vultrToken) {
      try {
        const vRes = await fetch(`${vultrUrl}/api/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CamRadar-Token': vultrToken,
          },
          body: JSON.stringify({ campaigns: batch }),
          signal: AbortSignal.timeout(30000),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          console.log(`[${platformName}] Vultr 싱크: ${vData.inserted ?? 0}개 신규`);
        }
      } catch (vErr) {
        console.warn(`[${platformName}] Vultr 싱크 오류 (무시): ${vErr.message}`);
      }
    }

    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return { inserted: totalInserted, skipped: rows.length - totalInserted };
}

export async function fetchWithRetry(url, options = {}, retries = 2) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    ...options.headers,
  }
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, headers: defaultHeaders, signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (err) {
      if (i === retries) throw err
      await new Promise(r => setTimeout(r, 1500 * (i + 1)))
    }
  }
}

export function parseNum(text) {
  if (!text) return 0
  const n = parseInt(text.replace(/[^0-9]/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * 채널 타입 감지 (어디에 올리는가)
 * 반환: 블로그 | 인스타 | 릴스 | 유튜브 | 클립 | 틱톡
 */
export function detectChannel(text, imgSrcs = []) {
  // 1) 아이콘 기반 채널 감지
  if (imgSrcs.length) {
    if (imgSrcs.some(s => /insta_icon|insta-icon/i.test(s))) return '인스타'
    if (imgSrcs.some(s => /clip_icon|clip-icon|naver.clip/i.test(s))) return '클립'
    if (imgSrcs.some(s => /youtube|yt_icon/i.test(s))) return '유튜브'
    if (imgSrcs.some(s => /reels/i.test(s))) return '릴스'
  }

  const t = (text || '').toLowerCase()
  // 2) [인스타+쿠팡구매평], [블로그+방문형] 등 복합 접두어에서 채널 감지
  const prefixMatch = t.match(/^\[\s*(블로그|인스타|인스타그램|유튜브|릴스|클립|틱톡)/)
  if (prefixMatch) {
    const ch = prefixMatch[1]
    if (ch === '릴스') return '릴스'
    if (ch === '클립') return '클립'
    if (ch === '인스타' || ch === '인스타그램') return '인스타'
    if (ch === '유튜브') return '유튜브'
    if (ch === '틱톡') return '틱톡'
    if (ch === '블로그') return '블로그'
  }
  if (t.includes('릴스') || t.includes('reels')) return '릴스'
  if (t.includes('클립') || t.includes('naverclip')) return '클립'
  if (t.includes('인스타') || t.includes('instagram')) return '인스타'
  if (t.includes('유튜브') || t.includes('youtube')) return '유튜브'
  if (t.includes('틱톡') || t.includes('tiktok')) return '틱톡'
  return '블로그'
}

/**
 * 수령 방식 감지 (어떻게 받는가)
 * 반환: 배송형 | 방문형 | 구매평 | 재택형
 */
export function detectDelivery(text) {
  const t = (text || '').toLowerCase()
  // 쿠팡구매평, 네이버구매평 등 플랫폼 구매평 패턴 포함
  if (t.includes('구매평') || t.includes('구매형') || t.includes('구매후기') || t.includes('구매 후') || t.includes('리얼구매') || t.includes('쿠팡구매') || t.includes('네이버구매')) return '구매평'
  if (t.includes('재택') || t.includes('온라인리뷰') || t.includes('재택형') || t.includes('기자단')) return '재택형'
  
  if (t.includes('배송') || t.includes('택배')) return '배송형'
  if (t.includes('방문') || t.includes('매장') || t.includes('현장') || t.includes('visit') || t.includes('초대')) return '방문형'
  
  const regions = ['서울','경기','인천','강원','제주','부산','대구','울산','광주','대전','충남','충북','전남','전북','경남','경북']
  if (regions.some(r => t.includes(r))) return '방문형'
  if (t.match(/\[.*(동|구|역|점|시|군|로)\s*\]/)) return '방문형'
  
  // 물건 등에 대한 일반 캠페인은 기본적으로 배송형 처리
  return '배송형'
}

/**
 * @deprecated detectChannel() 사용 권장
 * 하위 호환을 위해 유지
 */
export function detectType(text, imgSrcs = []) {
  return detectChannel(text, imgSrcs)
}
