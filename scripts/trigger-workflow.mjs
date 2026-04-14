import https from 'https';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const categories = process.argv[2] || '보험,세금,복지정책,부동산,주식';

if (!token) {
  console.error('❌ GITHUB_TOKEN 환경변수 없음');
  process.exit(1);
}

const body = JSON.stringify({
  ref: 'main',
  inputs: { mode: 'news', categories }
});

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/kimminju27/-/actions/workflows/auto-posts.yml/dispatches',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Node.js',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  console.log('HTTP', res.statusCode);
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    if (res.statusCode === 204) {
      console.log(`✅ 워크플로우 트리거 성공 (categories: ${categories})`);
    } else {
      console.error('❌ 실패:', data);
    }
  });
});
req.on('error', e => console.error(e));
req.write(body);
req.end();
