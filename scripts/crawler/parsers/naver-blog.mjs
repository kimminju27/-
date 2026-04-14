// 네이버 블로그 RSS 파서 (어포스푼, 원더블 공통)
import { fetchWithRetry } from '../utils.mjs'

export async function parse(rssUrl) {
  const res = await fetchWithRetry(rssUrl, {
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }
  })
  const xml = await res.text()

  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = decodeEntities(extractTag(block, 'title'))
    const link = extractTag(block, 'link') || extractTag(block, 'guid')
    const desc = decodeEntities(extractTag(block, 'description') || '')

    if (!title || !link) continue

    // 체험단 관련 게시글 필터
    if (!isExperiencePost(title, desc)) continue

    items.push({
      title,
      campaign_url: link,
      campaign_type: '블로그',
      applicants: 0,
      capacity: null,
      deadline_text: null,
    })
  }

  return items
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`))
  return m ? (m[1] || m[2] || '').trim() : ''
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim()
}

function isExperiencePost(title, desc) {
  const text = title + ' ' + desc

  // 반드시 모집/신청 의미 단어 포함
  const recruitWords = ['모집', '신청', '체험단', '리뷰어 모집', '캠페인 모집', '블로거 모집', '인플루언서 모집']
  const hasRecruit = recruitWords.some(k => text.includes(k))
  if (!hasRecruit) return false

  // 체험/리뷰 관련 단어도 포함
  const expWords = ['체험', '리뷰', '협찬', '제공', '캠페인', '무료 제공', '무상 제공']
  return expWords.some(k => text.includes(k))
}
