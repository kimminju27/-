// 메타체험단 — JSON API (campaign_list.php?json=list&page=N)
export async function parse(baseUrl) {
  const results = []
  const seen = new Set()
  const origin = 'https://meta-chehumdan.com'

  for (let page = 1; page <= 100; page++) {
    try {
      const res = await fetch(
        `${origin}/campaign_list.php?json=list&category_id=&keyword=&cp_media=&orderby=cp_id&page=${page}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `${origin}/campaign_list.php` } }
      )
      const data = await res.json()
      const items = data?.list
      if (!items || items.length === 0) break

      for (const item of items) {
        const url = `${origin}/campaign.php?cp_id=${item.cp_id}`
        if (seen.has(url)) continue
        seen.add(url)

        const title = item.cp_subject || ''
        if (!title || title.length < 2) continue

        results.push({
          title,
          campaign_url: url,
          campaign_type: null,
          deadline_text: item.cp_end_date || null,
          applicants: parseInt(item.cp_apply_count) || 0,
          capacity: parseInt(item.cp_limit) || null,
        })
      }
    } catch (err) {
      console.warn(`[메타체험단 API] 페이지 ${page} 실패:`, err.message)
      break
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`[메타체험단 API] 총 ${results.length}개 수집`)
  return results
}
