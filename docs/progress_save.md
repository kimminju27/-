# 🗂️ 캠레이더 WordPress 이식 — 진행 상황 저장 (2026-06-05)

## ✅ 완료된 작업 목록

### [코드 개발] 모두 완료, GitHub push됨
- [x] 워드프레스 커스텀 테마 `camradar-theme` 개발 완료
  - `wp-content/themes/camradar-theme/style.css`
  - `wp-content/themes/camradar-theme/functions.php`
    - `campaign` 커스텀 포스트 타입
    - 인플루언서 SNS 메타 필드
    - 실시간 SNS 통계 스크래퍼 AJAX
    - 체험단 신청 + bloginf0360@outlook.com 이메일 알림
    - 크롤러 동기화용 REST API `/wp-json/camradar/v1/sync-campaigns`
    - 회원가입/로그인 `[camradar_auth]` 숏코드 (PortOne 본인인증 포함)
- [x] 크롤러 `index.mjs`, `utils.mjs` 워드프레스 REST API로 전환 (Supabase 제거)

### [가비아 호스팅] 거의 완료
- [x] 가비아 워드프레스 호스팅 결제 완료 (2026-06-05)
  - 서비스: 워드프레스호스팅 / 베이직 트래픽 무제한
  - 대표 도메인: `bloginfo360.com`
  - 이용 기간: 1개월
- [x] FTP 허용 IP 등록: `119.205.57.248` (사용자가 엣지 브라우저로 직접 완료)
- [x] FTP 비밀번호: `camradar2026!` 으로 변경 완료 (엣지로)
- [x] DB 비밀번호: `camradar2026!` 으로 변경 완료 (엣지로)

---

## 🔑 가비아 서버 접속 정보 (현재 확인된 값)

| 항목 | 값 |
|---|---|
| 도메인 | `bloginfo360.com` |
| 기본 도메인 | `camrader.gabia.io` |
| 워드프레스 관리자 주소 | `http://bloginfo360.com/wp-admin` |
| 서버 IP | `182.162.142.102` |
| FTP 접속 ID | `camrader` |
| FTP 비밀번호 | `camradar2026!` |
| DB 주소 | `db.bloginfo360.com` |
| DB 이름 | `dbcamrader` |
| DB 접속 ID | `camrader` |
| DB 비밀번호 | `camradar2026!` |
| 가비아 구글 로그인 | `minju042796@gmail.com` / `alswn9699!` |

> ⚠️ 가비아 콘솔 작업은 **엣지(Edge) 브라우저**에서만 정상 작동 (크롬 오류 확인됨)

---

## ✅ 2026-06-06 추가 완료
- [x] 워드프레스 테마 PHP 템플릿 파일 완성
  - `header.php` — 사이트 헤더 (로그인/로그아웃 분기)
  - `footer.php` — 사이트 푸터
  - `front-page.php` — 메인 체험단 검색 페이지 (WP REST API 연동)
  - `index.php` — 기본 목록 템플릿
  - `page.php` — 일반 페이지 템플릿
  - `single-campaign.php` — 캠페인 상세 페이지
  - `404.php` — 에러 페이지
  - `functions.php` — Tailwind CDN + 공통 CSS enqueue 추가
- [x] `camradar-theme.zip` 생성 완료
  - 경로: `f:\2026 team-20260606T050641Z-3-001\2026 team\cam rader\camradar-theme.zip`
  - **FTP 불필요 — WP 관리자에서 ZIP 업로드로 진행**

---

## 🚧 다음에 바로 해야 할 작업 (Next Steps)

### 1. 워드프레스 관리자 테마 ZIP 업로드 (최우선, FTP 없이 가능)
```
1. http://bloginfo360.com/wp-admin 접속 (가비아 초기 비밀번호로 로그인)
2. 외모(Appearance) → 테마(Themes) → 새로 추가(Add New) → 테마 업로드(Upload Theme)
3. camradar-theme.zip 파일 선택 → 지금 설치(Install Now)
4. CamRadar Premium Theme → 활성화(Activate)
```

### 2. 워드프레스 관리자 비밀번호 변경
- WP 관리자 첫 로그인 → 사용자 → 프로필 → 비밀번호 변경

### 3. 무료 SSL(https) 적용
- 가비아 콘솔(엣지 브라우저) → 보안 → Let's Encrypt 무료 SSL 설치

### 4. 소셜 로그인 플러그인 설치 (Nextend Social Login)
- WP 관리자 → 플러그인 → 새로 추가 → 'Nextend Social Login' 검색 후 설치·활성화
- 구글/카카오 OAuth 키 입력

### 5. 크롤러 GitHub Actions 환경변수 업데이트
- `WP_URL=https://bloginfo360.com`
- `WP_SYNC_TOKEN=camradar-secret-sync-token-2026`

---

## 📌 재개 시 첫 번째 할 일
> ZIP 업로드 (FTP 없이 어디서든 가능)
> 파일 위치: `f:\2026 team-20260606T050641Z-3-001\2026 team\cam rader\camradar-theme.zip`
> 업로드 주소: http://bloginfo360.com/wp-admin → 외모 → 테마 → 새로 추가 → 테마 업로드
