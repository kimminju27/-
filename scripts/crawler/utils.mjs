// 크롤러 공통 유틸리티
import crypto from 'crypto'

/**
 * 제목 + 플랫폼명으로 중복 방지용 해시 생성
 */
export function makeHash(platformName, title) {
  return crypto.createHash('md5').update(`${platformName}::${title}`).digest('hex')
}

/**
 * 캠페인 데이터를 Supabase에 upsert
 * content_hash 기준으로 중복 무시
 */
export async function upsertCampaigns(supabase, platformName, platformId, campaigns) {
  if (!campaigns || campaigns.length === 0) return { inserted: 0, skipped: 0 }

  const rows = campaigns
    .filter(c => c.title && c.campaign_url)
    .map(c => ({
      platform_id: platformId || null,
      platform_name: platformName,
      title: c.title.trim().substring(0, 300),
      campaign_url: c.campaign_url,
      campaign_type: c.campaign_type || '블로그',
      applicants: parseInt(c.applicants) || 0,
      capacity: parseInt(c.capacity) || null,
      deadline_text: c.deadline_text || null,
      content_hash: makeHash(platformName, c.title.trim()),
      crawled_at: new Date().toISOString(),
      is_active: true,
    }))

  const { data, error } = await supabase
    .from('campaigns')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id')

  if (error) {
    console.error(`[${platformName}] upsert 오류:`, error.message)
    return { inserted: 0, skipped: rows.length }
  }

  return { inserted: data?.length || 0, skipped: rows.length - (data?.length || 0) }
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
 * 날짜 텍스트 파싱 (D-n 계산)
 */
export function parseDDay(text) {
  if (!text) return null
  const cleaned = text.replace(/[^0-9./-]/g, '').trim()
  if (!cleaned) return null
  return cleaned
}

/**
 * 숫자 파싱
 */
export function parseNum(text) {
  if (!text) return 0
  const n = parseInt(text.replace(/[^0-9]/g, ''))
  return isNaN(n) ? 0 : n
}
