import https from 'https';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const OWNER = 'kimminju27';
const REPO = '-';
const TOKEN = process.env.GH_TOKEN; // 실행 시: GH_TOKEN=<your_pat> node scripts/set_gh_secrets.mjs

const SECRETS = {
  WP_URL: 'https://bloginfo360.com',
  WP_SYNC_TOKEN: 'camradar-secret-sync-token-2026',
};

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'camradar-setup',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
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
  const _sodium = require('libsodium-wrappers');
  await _sodium.ready;
  const sodium = _sodium;

  console.log('GitHub Secrets 등록 시작...');

  const keyRes = await apiRequest('GET', `/repos/${OWNER}/${REPO}/actions/secrets/public-key`);
  if (keyRes.status !== 200) {
    console.error('공개키 조회 실패:', keyRes.status, JSON.stringify(keyRes.body));
    process.exit(1);
  }
  const { key, key_id } = keyRes.body;
  console.log(`공개키 ID: ${key_id}`);

  for (const [name, value] of Object.entries(SECRETS)) {
    console.log(`  등록 중: ${name} = ${value}`);

    const publicKeyBytes = Buffer.from(key, 'base64');
    const secretBytes = Buffer.from(value, 'utf8');
    const encrypted = sodium.crypto_box_seal(secretBytes, publicKeyBytes);
    const encryptedBase64 = Buffer.from(encrypted).toString('base64');

    const res = await apiRequest(
      'PUT',
      `/repos/${OWNER}/${REPO}/actions/secrets/${name}`,
      { encrypted_value: encryptedBase64, key_id }
    );

    if (res.status === 201 || res.status === 204) {
      console.log(`  ✅ ${name} 등록 완료 (${res.status})`);
    } else {
      console.error(`  ❌ ${name} 실패: ${res.status}`, JSON.stringify(res.body));
    }
  }

  console.log('\n모든 Secrets 등록 완료!');
}

main().catch(console.error);
