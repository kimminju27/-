// 레뷰 — SPA (React), /campaign/ 패턴, dl>dt:nth-child(2) 전용 셀렉터
import { playwrightParse } from '../utils-playwright.mjs'

export async function parse(baseUrl) {
  // 레뷰 홈의 캠페인 카드 구조:
  //   <a class="link" href="/campaign/{id}?...">
  //     <div class="thumb"><img alt="[브랜드] 제목"></div>
  //     <div class="info">
  //       <dl>
  //         <dt> 채널아이콘 + "N일 남음" </dt>  ← [0] 건너뜀
  //         <dt> [브랜드] 상품명 </dt>           ← [1] ✅ 실제 제목
  //         <dt> 보상품 설명 </dt>               ← [2] 건너뜀
  //       </dl>
  //     </div>
  //   </a>
  const items = await playwrightParse(baseUrl, '/campaign/', {
    extraWaitMs: 3000,
    // dt:nth-child(2) = 두 번째 dt = 실제 제목
    titleSelector: 'dl dt:nth-child(2)',
  })

  // 폴백: /campaign/ 결과가 없으면 img alt 속성에서 제목 추출 시도
  if (items.length === 0) {
    return playwrightParse(baseUrl, '/campaign/', {
      extraWaitMs: 4000,
      titleSelector: 'div.thumb img',  // alt 속성에도 제목이 있음
    })
  }

  return items
}
