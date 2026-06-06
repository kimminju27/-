// 비활성화: SPA/AJAX/fetch실패 플랫폼 캠페인을 WordPress에서 draft로 변경
import https from 'https';
import http from 'http';

const WP_URL = process.env.WP_URL || 'https://bloginfo360.com';
const WP_SYNC_TOKEN = process.env.WP_SYNC_TOKEN || 'camradar-secret-sync-token-2026';

const DEACTIVATE = [
  // SPA (React/Next.js/Vue — cheerio 불가)
  '레뷰', '리뷰쉐어', '체뷰', '오마이블로그', '캐시노트인플루언서', '모단',
  '위리뷰',     // React+Mantine SPA
  '태그바이',   // Nuxt.js SPA
  '리뷰진',     // 콘텐츠 미노출 SPA 추정
  // SSL/fetch 실패
  '티블',       // 오래된 SSL 설정
  // AJAX 동적 로드 (cheerio 불가)
  '4블로그',    // jQuery AJAX 무한스크롤
  '체험단모음', // AJAX 방식
  '리뷰의민족', // JS onClick 링크
  // 일반 포스팅 섞임
  '어포스푼', '원더블',
];

function wpRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(WP_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CamRadar-Token': WP_SYNC_TOKEN,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('비활성화 대상:', DEACTIVATE.join(', '));

  let totalDeactivated = 0;

  for (const platform of DEACTIVATE) {
    let page = 1;
    while (true) {
      const res = await wpRequest(
        'GET',
        `/wp-json/wp/v2/campaigns?meta_key=platform_name&meta_value=${encodeURIComponent(platform)}&status=publish&per_page=100&page=${page}`
      );

      if (res.status !== 200 || !Array.isArray(res.body) || res.body.length === 0) break;

      for (const campaign of res.body) {
        const upd = await wpRequest('POST', `/wp-json/wp/v2/campaigns/${campaign.id}`, { status: 'draft' });
        if (upd.status === 200) {
          totalDeactivated++;
        } else {
          console.warn(`  ID ${campaign.id} draft 변경 실패:`, upd.status);
        }
      }

      if (res.body.length < 100) break;
      page++;
    }
    console.log(`  ${platform}: 비활성화 완료`);
  }

  console.log(`\n완료: 총 ${totalDeactivated}개 캠페인을 draft로 변경`);
}

main().catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
