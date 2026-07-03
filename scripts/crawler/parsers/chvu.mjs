// 체뷰 — REST API (/v2/campaigns?category=X&page=N)
export async function parse(baseUrl) {
  const results = []
  const seen = new Set()
  const CATEGORIES = ['popular', 'newly', 'imminent']

  const CH_MAP = { blog: '블로그', instagram: '인스타', reels: '릴스', youtube: '유튜브' }
  const ACT_MAP = { delivery: '배송형', visit: '방문형', purchase: '구매형' }

  for (const category of CATEGORIES) {
    for (let page = 1; page <= 50; page++) {
      try {
        const res = await fetch(
          `https://chvu.co.kr/v2/campaigns?category=${category}&page=${page}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        )
        const data = await res.json()
        const items = data?.data
        if (!items || items.length === 0) break

        for (const item of items) {
          const url = `https://chvu.co.kr/campaigns/${item.campaignId}`
          if (seen.has(url)) continue
          seen.add(url)

          results.push({
            title: item.title || item.subtitle || '',
            campaign_url: url,
            campaign_type: CH_MAP[item.channel] || null,
            delivery_type: ACT_MAP[item.activity] || null,
            applicants: item.currentApplicants || 0,
            capacity: item.reviewerLimit || null,
            deadline_text: item.closeAt ? String(item.closeAt).slice(0, 10) : null,
          })
        }
      } catch (err) {
        console.warn(`[체뷰 API] ${category} 페이지 ${page} 실패:`, err.message)
        break
      }
      await new Promise(r => setTimeout(r, 300))
    }
  }

  console.log(`[체뷰 API] 총 ${results.length}개 수집`)
  return results
}
