"""테마 ZIP 재업로드 — admin-ajax sync 변경사항 반영"""
import asyncio
import os
from playwright.async_api import async_playwright

WP_BASE = "http://bloginfo360.com"
USERNAME = "camrader"
PASSWORD = "camrader2026!"
ZIP_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "camradar-theme.zip")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        # 로그인
        print("1. 로그인 중...")
        await page.goto(f"{WP_BASE}/wp-login.php", wait_until='domcontentloaded')
        await page.wait_for_selector('#user_login', state='visible', timeout=15000)
        await page.wait_for_timeout(800)
        await page.evaluate("document.cookie = 'wordpress_test_cookie=WP Cookie check; path=/'")
        await page.fill('#user_login', '')
        await page.fill('#user_login', USERNAME)
        await page.fill('#user_pass', '')
        await page.fill('#user_pass', PASSWORD)
        login_val = await page.input_value('#user_login')
        pass_val = await page.input_value('#user_pass')
        print(f"   사용자명 필드: '{login_val}' ({len(login_val)}자) / 비밀번호 길이: {len(pass_val)}자")
        await page.evaluate("document.querySelector('[name=testcookie]') && (document.querySelector('[name=testcookie]').value = '1')")
        await page.click('#wp-submit')
        try:
            await page.wait_for_url('**/wp-admin/**', timeout=20000)
        except Exception:
            pass
        print(f"   현재 URL: {page.url}")

        if 'wp-admin' not in page.url:
            err_el = await page.query_selector('#login_error')
            err = await err_el.inner_text() if err_el else '알 수 없는 오류'
            print(f"   로그인 실패: {err}")
            await page.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'login_fail.png'), full_page=True)
            print("   스크린샷 저장: login_fail.png")
            await browser.close()
            return
        print("   로그인 성공!")

        # 테마 업로드 페이지 — 직접 업로드 화면으로 (?browse=upload 또는 다이렉트 URL)
        print("2. 테마 업로드 페이지 이동...")
        shot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
        await page.goto(f"{WP_BASE}/wp-admin/theme-install.php", wait_until='load')
        await page.wait_for_timeout(1500)

        # "테마 업로드" 버튼 클릭 → 업로드 폼 노출
        clicked = await page.evaluate("""
            () => {
                const links = Array.from(document.querySelectorAll('a'));
                const btn = links.find(a => a.textContent.includes('테마 업로드') || a.textContent.includes('Upload Theme'));
                if (btn) { btn.click(); return true; }
                return false;
            }
        """)
        print(f"   업로드 버튼 클릭: {clicked}")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(shot_dir, 'upload_page_1_afterclick.png'), full_page=True)

        # 파일 업로드
        print(f"3. ZIP 업로드: {ZIP_PATH}")
        file_input = page.locator('input[type="file"]')
        count = await file_input.count()
        print(f"   파일 input 개수: {count}")
        print(f"   ZIP 파일 크기: {os.path.getsize(ZIP_PATH)} bytes, 경로: {ZIP_PATH}")
        with open(ZIP_PATH, 'rb') as f:
            zip_bytes = f.read()
        await file_input.first.set_input_files(files=[{
            "name": "camradar-theme.zip",
            "mimeType": "application/zip",
            "buffer": zip_bytes,
        }])
        await page.wait_for_timeout(3000)

        await page.screenshot(path=os.path.join(shot_dir, 'upload_page_2_afterfile.png'), full_page=True)
        print("   파일 선택 후 스크린샷 저장")

        # 설치 버튼 클릭 (JS로 직접 — 화면 밖/숨김 요소 대응)
        clicked2 = await page.evaluate("""
            () => {
                const btn = document.querySelector('#install-theme-submit')
                    || document.querySelector('input[name="install-theme-submit"]')
                    || Array.from(document.querySelectorAll('input[type="submit"]')).find(b => b.value && (b.value.includes('설치') || b.value.includes('Install')));
                if (btn) { btn.click(); return 'clicked:' + (btn.value || btn.textContent); }
                return 'not-found';
            }
        """)
        print(f"   설치 버튼: {clicked2}")
        try:
            await page.wait_for_load_state('load', timeout=20000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(shot_dir, 'upload_page_3_afterinstall.png'), full_page=True)
        print(f"   설치 후 URL: {page.url}")
        page_text = await page.inner_text('#wpbody-content')
        print(f"   페이지 텍스트(앞부분): {page_text[:300]}")

        # 교체 설치
        replace_btn = page.locator('a:has-text("교체 설치"), a:has-text("Replace current"), a[href*="overwrite"]')
        if await replace_btn.count() > 0:
            print("   교체 설치 클릭...")
            await replace_btn.first.click()
            try:
                await page.wait_for_load_state('load', timeout=15000)
            except Exception:
                pass

        # 활성화
        activate_btn = page.locator('a:has-text("활성화"), a:has-text("Activate")')
        if await activate_btn.count() > 0:
            print("   테마 활성화...")
            await activate_btn.first.click()
            try:
                await page.wait_for_load_state('load', timeout=15000)
            except Exception:
                pass
            print("   활성화 완료!")
        else:
            print("   이미 활성화됨 (또는 업로드 완료)")

        print(f"   현재 URL: {page.url}")

        await browser.close()
        print("\n=== 테마 업데이트 완료! ===")

asyncio.run(main())
