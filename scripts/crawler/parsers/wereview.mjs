// 위리뷰 — REST API (5,800+ 캠페인, 117페이지)
// POST /api/campaign/search?page=N&size=50&sort=id,desc
export async function parse(baseUrl) {
  const results = []
  const seen = new Set()

  const MEDIA_MAP = {
    BLOG: '블로그', INSTAGRAM: '인스타', REELS: '릴스',
    YOUTUBE: '유튜브', TIKTOK: '틱톡', CLIP: '클립',
  }
  const ACTIVITY_MAP = {
    PRODUCT: '배송형', VISIT: '방문형', PURCHASE: '구매형',
    HOME: '재택형', DIGITAL: '디지털',
  }

  for (let page = 1; page <= 150; page++) {
    try {
      const res = await fetch(
        `https://www.wereview.fun/api/campaign/search?page=${page}&size=50&sort=id,desc`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          body: JSON.stringify({}),
        }
      )
      const data = await res.json()
      const items = data?.data?.content
      if (!items || items.length === 0) break

      for (const item of items) {
        const url = `https://www.wereview.fun/campaigns/${item.id}`
        if (seen.has(url)) continue
        seen.add(url)

        const title = item.serveText || item.productName || item.brandName || ''
        if (!title || title.length < 2) continue

        const endDate = item.campaignCycleTimeline?.campaignApplyEndDate
        results.push({
          title,
          campaign_url: url,
          campaign_type: MEDIA_MAP[item.mediaType] || null,
          delivery_type: ACTIVITY_MAP[item.campaignType] || null,
          applicants: item.displayApplyCount || 0,
          capacity: item.maxApplyCount || null,
          deadline_text: endDate ? endDate.slice(0, 10) : null,
        })
      }

      if (page >= (data?.data?.totalPages || 1)) break
    } catch (err) {
      console.warn(`[위리뷰 API] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`[위리뷰 API] 총 ${results.length}개 수집`)
  return results
}
