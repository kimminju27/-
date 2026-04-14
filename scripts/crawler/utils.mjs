// 크롤러 공통 유틸리티
import crypto from 'crypto'

// 불량 제목 필터
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
  if (t.length < 6) return false
  if (t.length > 200) return false
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(t)) return false
  }
  return true
}

export function makeHash(platformName, title) {
  return crypto.createHash('md5').update(`${platformName}::${title}`).digest('hex')
}

/**
 * 캠페인 upsert
 * - 신규: INSERT (first_seen_at + crawled_at = NOW())
 * - 기존: crawled_at + is_active만 갱신 (first_seen_at 유지)
 */
export async function upsertCampaigns(supabase, platformName, platformId, campaigns) {
  if (!campaigns || campaigns.length === 0) return { inserted: 0, skipped: 0 }

  const now = new Date().toISOString()

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
      crawled_at: now,
      first_seen_at: now,  // 신규 시 설정, 기존 시 ignoreDuplicates로 보존됨
      is_active: true,
    }))

  if (rows.length === 0) return { inserted: 0, skipped: 0 }

  // Step 1: 신규 캠페인만 INSERT (기존은 건드리지 않아 first_seen_at 보존)
  const { data: newData, error: insertErr } = await supabase
    .from('campaigns')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id')

  if (insertErr) {
    console.error(`[${platformName}] insert 오류:`, insertErr.message)
    return { inserted: 0, skipped: rows.length }
  }

  // Step 2: 기존 캠페인의 crawled_at + is_active 갱신 (청크 단위)
  const hashes = rows.map(r => r.content_hash)
  for (let i = 0; i < hashes.length; i += 200) {
    const chunk = hashes.slice(i, i + 200)
    await supabase
      .from('campaigns')
      .update({ crawled_at: now, is_active: true })
      .in('content_hash', chunk)
      .eq('platform_name', platformName)
  }

  return { inserted: newData?.length || 0, skipped: rows.length - (newData?.length || 0) }
}

/**
 * 이번 크롤에서 미수집된 캠페인 비활성화 (모집 마감 처리)
 */
export async function deactivateOldCampaigns(supabase, platformName, crawlStart) {
  const { error } = await supabase
    .from('campaigns')
    .update({ is_active: false })
    .eq('platform_name', platformName)
    .lt('crawled_at', crawlStart)
    .eq('is_active', true)

  if (error) console.warn(`[${platformName}] 비활성화 실패:`, error.message)
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
