"""WP 관리자 자동 설정 스크립트"""
import asyncio
from playwright.async_api import async_playwright

WP_BASE = "http://bloginfo360.com"
USERNAME = "camrader"
PASSWORD = "camrader2026!"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        # 1. 로그인 — 먼저 페이지 방문해 testcookie 받기
        print("1. WP 로그인 중...")
        await page.goto(f"{WP_BASE}/wp-login.php", wait_until='domcontentloaded')
        # JS로 testcookie 직접 설정
        await page.evaluate("document.cookie = 'wordpress_test_cookie=WP Cookie check; path=/'")
        await page.fill('#user_login', USERNAME)
        await page.fill('#user_pass', PASSWORD)
        # hidden input testcookie 값 설정
        await page.evaluate("document.querySelector('[name=testcookie]') && (document.querySelector('[name=testcookie]').value = '1')")
        await page.click('#wp-submit')
        await page.wait_for_load_state('networkidle', timeout=20000)
        print(f"   현재 URL: {page.url}")

        if 'wp-admin' not in page.url:
            err = await page.inner_text('#login_error') if await page.query_selector('#login_error') else '알 수 없는 오류'
            print(f"   로그인 실패: {err}")
            await browser.close()
            return
        print("   로그인 성공!")

        # 2. 사이트 제목 변경
        print("2. 사이트 제목 설정 중...")
        await page.goto(f"{WP_BASE}/wp-admin/options-general.php", wait_until='networkidle')
        await page.fill('#blogname', '캠레이더')
        await page.fill('#blogdescription', '블로그·인스타·유튜브 체험단 통합 검색')
        await page.click('#submit')
        await page.wait_for_load_state('networkidle')
        print("   완료!")

        # 3. 퍼머링크 — 글 이름 선택 (REST API + campaign URL 작동에 필수)
        print("3. 퍼머링크 설정 중...")
        await page.goto(f"{WP_BASE}/wp-admin/options-permalink.php", wait_until='networkidle')
        await page.check('#permalink-input-post-name')
        await page.click('#submit')
        await page.wait_for_load_state('networkidle')
        print("   완료!")

        # 4. Nextend Social Login 플러그인 설치
        print("4. Nextend Social Login 플러그인 설치 중...")
        await page.goto(f"{WP_BASE}/wp-admin/plugin-install.php?s=nextend+social+login&tab=search&type=term", wait_until='networkidle')
        await page.wait_for_timeout(2000)

        install_btn = page.locator('.plugin-card:has-text("Nextend Social Login and Register") .install-now').first
        if await install_btn.count() > 0 and await install_btn.is_visible():
            await install_btn.click()
            await page.wait_for_timeout(10000)
            activate_btn = page.locator('.plugin-card:has-text("Nextend Social Login and Register") .activate-now').first
            if await activate_btn.count() > 0 and await activate_btn.is_visible():
                await activate_btn.click()
                await page.wait_for_load_state('networkidle')
                print("   설치 및 활성화 완료!")
            else:
                print("   설치 완료 (수동 활성화 필요할 수 있음)")
        else:
            print("   이미 설치됨 또는 검색 결과 없음 — 확인 중...")
            already = page.locator('.plugin-card:has-text("Nextend Social Login and Register") .activate-now').first
            if await already.count() > 0:
                await already.click()
                await page.wait_for_load_state('networkidle')
                print("   활성화 완료!")

        # 5. 완료 확인
        print("\n5. 최종 확인 중...")
        await page.goto(f"{WP_BASE}/wp-json/wp/v2/campaigns?per_page=1", wait_until='networkidle')
        body = await page.text_content('body')
        if '"id"' in body or '[]' in body:
            print("   REST API 정상 작동!")
        else:
            print(f"   REST API 응답: {body[:100]}")

        await browser.close()
        print("\n=== 모든 설정 완료! ===")
        print("다음 단계: GitHub Actions 환경변수 업데이트")

asyncio.run(main())
