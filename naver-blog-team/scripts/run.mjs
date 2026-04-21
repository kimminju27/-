/**
 * 네이버 블로그 자동 포스팅 메인 실행
 * - 글 생성 + 네이버 블로그 포스팅 일괄 실행
 *
 * 사용법:
 *   node scripts/run.mjs                      # 전체 카테고리 (경제,부동산,주식,복지정책)
 *   CATEGORIES=경제,주식 node scripts/run.mjs  # 특정 카테고리만
 *   GENERATE_ONLY=true node scripts/run.mjs    # 글 생성만 (포스팅 없이)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// .env 로드
const envPath = path.join(ROOT, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('✅ .env 로드 완료');
} else {
  console.warn('⚠️  .env 파일이 없습니다. .env.example을 복사하여 .env를 만드세요.');
}

import { generateAll } from './generate.mjs';
import { postToNaver } from './post-naver.mjs';
import { postToNaverDraft } from './post-naver-draft.mjs';
import { postToTistory } from './post-tistory.mjs';

const CATEGORIES = (process.env.CATEGORIES || '경제,부동산,주식,복지정책')
  .split(',').map(s => s.trim()).filter(Boolean);

const GENERATE_ONLY = process.env.GENERATE_ONLY === 'true';
// DRAFT_ONLY: true이면 발행 대신 임시저장 (GitHub Actions CI용)
const DRAFT_ONLY = process.env.DRAFT_ONLY === 'true';
// CI_MODE: GitHub Actions 환경 감지 → channel 없이 번들 Chromium 사용
const CI_MODE = process.env.CI === 'true';
// TARGET: 'naver' | 'tistory' | 'both' (기본: naver)
const TARGET = (process.env.TARGET || 'naver').toLowerCase();
const POST_DELAY = parseInt(process.env.POST_DELAY || '5000');
// SLOT: 하루에 여러 번 실행할 때 포스팅 주제가 겹치지 않도록 슬롯 번호를 지정한다.
const SLOT = parseInt(process.env.SLOT || '1');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  네이버 블로그 자동 포스팅 시스템');
  console.log('═══════════════════════════════════════');
  console.log(`📋 카테고리: ${CATEGORIES.join(', ')}`);
  console.log(`🔢 슬롯: ${SLOT}`);
  console.log(`🎯 포스팅 대상: ${TARGET}`);
  console.log(`🔧 모드: ${GENERATE_ONLY ? '글 생성만' : '생성 + 포스팅'}`);
  console.log('');

  // ── 1단계: 글 생성 ──
  console.log('━━━ [1단계] 블로그 글 생성 ━━━');
  const results = await generateAll(CATEGORIES, SLOT);
  const successPosts = results.filter(r => !r.error && r.post);

  console.log(`\n✅ 생성 완료: ${successPosts.length}/${CATEGORIES.length}개`);

  if (successPosts.length === 0) {
    console.error('❌ 생성된 글이 없습니다. 종료합니다.');
    process.exit(1);
  }

  if (GENERATE_ONLY) {
    console.log('\nℹ️  GENERATE_ONLY=true → 포스팅 건너뜀');
    console.log('포스팅하려면: node scripts/run.mjs 또는 node scripts/post-naver.mjs drafts/파일명.json');
    return;
  }

  // ── 2단계: 포스팅 ──
  const targetLabel = TARGET === 'tistory' ? '티스토리' : TARGET === 'both' ? '네이버 + 티스토리' : '네이버';
  console.log(`\n━━━ [2단계] ${targetLabel} 포스팅 ━━━`);

  const needNaver = TARGET === 'naver' || TARGET === 'both';
  const needTistory = TARGET === 'tistory' || TARGET === 'both';

  if (needNaver && (!process.env.NAVER_ID || !process.env.NAVER_PASSWORD || !process.env.NAVER_BLOG_ID)) {
    console.error('❌ .env에 NAVER_ID, NAVER_PASSWORD, NAVER_BLOG_ID를 설정하세요.');
    process.exit(1);
  }
  if (needTistory && (!process.env.KAKAO_ID || !process.env.KAKAO_PASSWORD || !process.env.TISTORY_BLOG_NAME)) {
    console.error('❌ .env에 KAKAO_ID, KAKAO_PASSWORD, TISTORY_BLOG_NAME을 설정하세요.');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,  // CI에서는 xvfb 가상 디스플레이가 처리
    ...(CI_MODE ? {} : { channel: 'chrome' }),  // CI: 번들 Chromium, 로컬: 시스템 Chrome
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-web-security'],
    slowMo: CI_MODE ? 0 : 50,
  });

  const postResults = [];

  try {
    for (let i = 0; i < successPosts.length; i++) {
      const { category, post } = successPosts[i];
      console.log(`\n[${i + 1}/${successPosts.length}] 포스팅: ${post.title}`);

      // 네이버 포스팅 (DRAFT_ONLY=true이면 임시저장, 아니면 발행)
      if (needNaver) {
        try {
          const result = DRAFT_ONLY
            ? await postToNaverDraft(post, browser)
            : await postToNaver(post, browser);
          postResults.push({ platform: DRAFT_ONLY ? '네이버(임시저장)' : '네이버', category, title: post.title, ...result });
        } catch (e) {
          console.error(`   ❌ [네이버] 포스팅 실패:`, e.message);
          postResults.push({ platform: '네이버', category, title: post.title, success: false, error: e.message });
        }
        if (needTistory) await sleep(3000);
      }

      // 티스토리 포스팅
      if (needTistory) {
        try {
          const result = await postToTistory(post, browser);
          postResults.push({ platform: '티스토리', category, title: post.title, ...result });
        } catch (e) {
          console.error(`   ❌ [티스토리] 포스팅 실패:`, e.message);
          postResults.push({ platform: '티스토리', category, title: post.title, success: false, error: e.message });
        }
      }

      if (i < successPosts.length - 1) {
        console.log(`   ⏳ 다음 포스팅까지 ${POST_DELAY / 1000}초 대기...`);
        await sleep(POST_DELAY);
      }
    }
  } finally {
    await browser.close();
  }

  // ── 최종 결과 ──
  console.log('\n═══════════════════════════════════════');
  console.log('  최종 결과');
  console.log('═══════════════════════════════════════');

  for (const r of postResults) {
    const icon = r.success ? '✅' : '❌';
    const platform = r.platform ? `[${r.platform}] ` : '';
    console.log(`${icon} ${platform}[${r.category}] ${r.title}`);
    if (r.url) console.log(`   🌐 ${r.url}`);
    if (r.error) console.log(`   ⚠️  ${r.error}`);
  }

  const successCount = postResults.filter(r => r.success).length;
  console.log(`\n🎉 완료: ${successCount}/${postResults.length}개 포스팅 성공`);
}

main().catch(e => {
  console.error('\n❌ 오류 발생:', e.message);
  process.exit(1);
});
