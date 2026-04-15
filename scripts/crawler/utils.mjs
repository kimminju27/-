// 크롤러 공통 유틸리티
import crypto from 'crypto'

const BAD_TITLE_PATTERNS = [
  /^(로그인|회원가입|마이페이지|공지사항|더보기|전체보기|신청하기|목록보기|홈|HOME)$/i,
  /^(블로그|인스타|유튜브|틱톡|방문|재택|체험단|캠페인|이벤트|기자단)$/i,
  /^(체험단\s*찾기|캠페인\s*목록|모집중|마감임박|인기|최신|추천)$/i,
  /^[\d\s\.\-\/]+$/,
  /^[^\uAC00-\uD7A3a-zA-Z]+$/,
]

function isValidTitle(title) {
  if (!title) return false
  const t = title.trim()
  if (t.length < 6 || t.length > 200) return false
  return !BAD_TITLE_PATTERNS.some(p => p.test(t))
}

export function makeHash(platformName, title) {
  return crypto.createHash('md5').update(`${platformName}::${title}`).digest('hex')
}

/**
 * 캠페인 upsert — ignoreDuplicates:true
 * crawled_at = 최초 삽입 시각 (이후 변경 안 됨)
 * → "오늘 신규" = crawled_at >= today 로 판별 가능
 */
export async function upsertCampaigns(supabase, platformName, platformId, campaigns) {
  if (!campaigns || campaigns.length === 0) return { inserted: 0, skipped: 0 }

  const now = new Date().toISOString()

  // 모든 파서 공통 제목 정제 (신청수·날짜·타입접두 제거)
  const sanitizeTitle = (raw) => raw
    .replace(/\d{4}[.\/-]\d{2}[.\/-]\d{2}(\s*\d{2}:\d{2}(:\d{2})?)?/g, '')
    .replace(/\(?\s*신청\s*[\d,]+\s*\/\s*[\d,]+\s*명?\s*\)?/g, '')
    .replace(/\d+\s*일\s*남음/g, '')
    .replace(/D-\d+/gi, '')
    .replace(/\s*오늘\s*마감/g, '')
    .replace(/^(매장방문형|배송형|구매형|방문형|재택형|구매평형|기자단형)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const rows = campaigns
    .filter(c => c.title && c.campaign_url && isValidTitle(c.title))
    .map(c => ({
      platform_id: platformId || null,
      platform_name: platformName,
      title: sanitizeTitle(c.title).substring(0, 200),
      campaign_url: c.campaign_url,
      campaign_type: c.campaign_type || '블로그',
      applicants: parseInt(c.applicants) || 0,
      capacity: parseInt(c.capacity) || null,
      deadline_text: c.deadline_text || null,
      content_hash: makeHash(platformName, c.title.trim()),
      // crawled_at 제외 → 신규 행은 DB DEFAULT(NOW()), 기존 행은 원래 값 유지
      is_active: true,
    }))

  if (rows.length === 0) return { inserted: 0, skipped: 0 }

  // ignoreDuplicates: false → 기존 행의 deadline_text·applicants·campaign_type 업데이트
  const { data, error } = await supabase
    .from('campaigns')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: false })
    .select('id')

  if (error) {
    console.error(`[${platformName}] upsert 오류:`, error.message)
    return { inserted: 0, skipped: rows.length }
  }

  return { inserted: data?.length || 0, skipped: rows.length - (data?.length || 0) }
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
 * 캠페인 타입 감지 — 모든 파서 공유
 * imgSrcs: 카드 내 img src 배열 (아이콘 기반 채널 감지용)
 * 방문형 캠페인은 "방문,블로그" 또는 "방문,인스타" 등 다중 타입 반환
 */
export function detectType(text, imgSrcs = []) {
  // 1) 채널 타입 감지 (아이콘 우선)
  let channelType = null
  if (imgSrcs.length) {
    if (imgSrcs.some(s => /insta_icon|insta-icon/i.test(s))) channelType = '인스타'
    else if (imgSrcs.some(s => /clip_icon|clip-icon|naver.clip/i.test(s))) channelType = '클립'
    else if (imgSrcs.some(s => /youtube|yt_icon/i.test(s))) channelType = '유튜브'
    else if (imgSrcs.some(s => /reels/i.test(s))) channelType = '릴스'
  }
  const t = (text || '').toLowerCase()
  if (!channelType) {
    if (t.includes('릴스') || t.includes('reels')) channelType = '릴스'
    else if (t.includes('클립') || t.includes('naverclip')) channelType = '클립'
    else if (t.includes('인스타') || t.includes('instagram')) channelType = '인스타'
    else if (t.includes('유튜브') || t.includes('youtube')) channelType = '유튜브'
    else if (t.includes('틱톡') || t.includes('tiktok')) channelType = '틱톡'
  }

  // 2) 형식 타입 감지
  const isVisit = t.includes('방문') || t.includes('매장')
  const isHome  = t.includes('재택') || t.includes('배송') || t.includes('구매')

  // 3) 방문형: 채널과 조합 (예: "방문,블로그" / "방문,인스타")
  if (isVisit) {
    const ch = channelType || '블로그'
    return `방문,${ch}`
  }

  // 4) 재택형 (배송/구매평)
  if (isHome) return '재택'

  return channelType || '블로그'
}
