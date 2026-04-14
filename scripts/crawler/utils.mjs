// 크롤러 공통 유틸리티
import crypto from 'crypto'

// 불량 제목 필터 (네비게이션/UI 텍스트 등)
const BAD_TITLE_PATTERNS = [
  /^(로그인|회원가입|마이페이지|공지사항|더보기|전체보기|신청하기|목록보기|홈|HOME)$/i,
  /^(블로그|인스타|유튜브|틱톡|방문|재택|체험단|캠페인|이벤트|기자단)$/i,
  /^(체험단\s*찾기|캠페인\s*목록|모집중|마감임박|인기|최신|추천)$/i,
  /^[\d\s\.\-\/]+$/,   // 숫자/날짜만 있는 경우
  /^[^\uAC00-\uD7A3a-zA-Z]+$/, // 한글/영문이 전혀 없는 경우
]

function isValidTitle(title) {
  if (!title) return false
  const t = title.trim()
  if (t.length < 6) return false   // 너무 짧음
  if (t.length > 200) return false  // 너무 긴 경우(nav 텍스트 덩어리 등)
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(t)) return false
  }
  return true
}

/**
 * 제목 + 플랫폼명으로 중복 방지용 해시 생성
 */
export function makeHash(platformName, title) {
  return crypto.createHash('md5').update(`${platformName}::${title}`).digest('hex')
}

/**
 * 캠페인 데이터를 Supabase에 upsert
 * content_hash 기준 충돌 시 crawled_at, is_active 갱신 (모집마감 자동 처리용)
 */
export async function upsertCampaigns(supabase, platformName, platformId, campaigns) {
  if (!campaigns || campaigns.length === 0) return { inserted: 0, skipped: 0 }

  const rows = campaigns
    .filter(c => c.title && c.campaign_url && isValidTitle(c.title))
    .map(c => ({
      platform_id: platformId || null,
      platform_name: platformName,
      title: c.title.trim().substring(0, 200),
      campaign_url: c.campaign_url,
      campaign_type: c.campaign_type || '블로그',
      applicants: parseInt(c.applicants) || 0,
      capacity: parseInt(c.capacity) || null,
      deadline_text: c.deadline_text || null,
      content_hash: makeHash(platformName, c.title.trim()),
      crawled_at: new Date().toISOString(),
      is_active: true,
    }))

  if (rows.length === 0) return { inserted: 0, skipped: 0 }

  // ignoreDuplicates: false → 기존 캠페인도 crawled_at/is_active 갱신
  const { data, error } = await supabase
    .from('campaigns')
    .upsert(rows, {
      onConflict: 'content_hash',
      ignoreDuplicates: false,
    })
    .select('id')

  if (error) {
    console.error(`[${platformName}] upsert 오류:`, error.message)
    return { inserted: 0, skipped: rows.length }
  }

  return { inserted: data?.length || 0, skipped: rows.length - (data?.length || 0) }
}

/**
 * 이번 크롤에서 수집되지 않은 해당 플랫폼 캠페인 비활성화
 * (모집 마감 = 사이트 목록에서 사라짐 = 비활성 처리)
 */
export async function deactivateOldCampaigns(supabase, platformName, crawledAt) {
  // crawledAt 이전에 crawled_at이 업데이트 안 된 캠페인 = 이번 크롤에서 안 보인 것
  const { error } = await supabase
    .from('campaigns')
    .update({ is_active: false })
    .eq('platform_name', platformName)
    .lt('crawled_at', crawledAt)
    .eq('is_active', true)

  if (error) {
    console.warn(`[${platformName}] 비활성화 실패:`, error.message)
  }
}

/**
 * HTTP fetch with retry (최대 2회)
 */
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

/**
 * 숫자 파싱
 */
export function parseNum(text) {
  if (!text) return 0
  const n = parseInt(text.replace(/[^0-9]/g, ''))
  return isNaN(n) ? 0 : n
}
