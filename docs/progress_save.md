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

## 🚧 다음에 바로 해야 할 작업 (Next Steps)

### 1. FTP 테마 업로드 (최우선)
```
로컬 경로: C:\Users\m1nde\Desktop\2026 team\cam rader\wp-content\themes\camradar-theme\
업로드 목적지: /wp-content/themes/camradar-theme/
```
- `style.css`
- `functions.php`

### 2. 워드프레스 관리자에서 테마 활성화
- `http://bloginfo360.com/wp-admin` 접속
- 외모(Appearance) → 테마(Themes) → CamRadar Premium Theme **활성화**

### 3. 워드프레스 관리자 비밀번호 설정
- `http://bloginfo360.com/wp-admin` 에서 가비아 제공 초기 비밀번호로 첫 로그인
- 관리자 비밀번호를 원하는 값으로 변경

### 4. 무료 SSL(https) 적용
- 가비아 콘솔 → 보안 → Let's Encrypt 무료 SSL 설치

### 5. 소셜 로그인 플러그인 설치 (Nextend Social Login)
- `http://bloginfo360.com/wp-admin` → 플러그인 → 새로 추가
- 'Nextend Social Login' 검색 후 설치 및 활성화
- 구글/카카오 OAuth 키 입력

### 6. 크롤러 GitHub Actions 환경변수 업데이트
- `WP_URL=https://bloginfo360.com`
- `WP_SYNC_TOKEN=camradar-secret-sync-token-2026`

---

## 📌 재개 시 첫 번째 할 일
> FTP 연결 테스트 후 테마 파일 업로드 시작
```
curl --ftp-pasv -u camrader:camradar2026! ftp://bloginfo360.com/
```
