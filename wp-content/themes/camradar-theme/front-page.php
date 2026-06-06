<?php get_header(); ?>

<!-- ===== 히어로 ===== -->
<section class="py-10 px-4" style="background:linear-gradient(135deg,#eef2ff 0%,#f4f6ff 55%,#fdf4ff 100%);">
  <div class="max-w-2xl mx-auto text-center">
    <div class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs mb-4 bg-white border border-indigo-100 text-indigo-600 font-bold shadow-sm">
      <span class="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
      1시간마다 자동 업데이트
    </div>
    <h1 class="text-3xl md:text-4xl font-black text-slate-900 mb-2 leading-tight">
      체험단 캠페인<br><span style="color:#4f46e5;">한 번에</span> 다 찾자
    </h1>
    <p class="text-slate-400 text-sm mb-6">37개 체험단 사이트 · 실시간 통합 검색</p>
    <div class="flex gap-2 bg-white rounded-2xl p-1.5 shadow-md border border-indigo-100 mb-5">
      <span class="pl-3 flex items-center text-slate-300 text-lg">🔍</span>
      <input id="search-input" type="text"
        placeholder="뷰티, 맛집, 강아지 간식, 서울..."
        class="flex-1 text-slate-800 text-sm outline-none px-2 py-2 bg-transparent" autocomplete="off">
      <button id="search-btn"
        class="px-5 py-2 rounded-xl text-white text-sm font-bold transition-colors active:scale-95"
        style="background:#4f46e5;" onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='#4f46e5'">
        검색
      </button>
    </div>
    <div id="popular-tags" class="flex flex-wrap justify-center gap-1.5"></div>
  </div>
</section>

<!-- ===== 통계 ===== -->
<div class="bg-white border-b border-slate-100">
  <div class="max-w-6xl mx-auto px-4 py-3 grid grid-cols-3 divide-x divide-slate-100 text-center">
    <div>
      <div id="stat-total" class="text-xl font-black" style="color:#4f46e5;">-</div>
      <div class="text-xs text-slate-400 mt-0.5">총 캠페인</div>
    </div>
    <div>
      <div id="stat-today" class="text-xl font-black" style="color:#4f46e5;">-</div>
      <div class="text-xs text-slate-400 mt-0.5">오늘 신규</div>
    </div>
    <div>
      <div id="stat-platforms" class="text-xl font-black" style="color:#4f46e5;">37+</div>
      <div class="text-xs text-slate-400 mt-0.5">연동 사이트</div>
    </div>
  </div>
</div>

<!-- ===== 필터 바 ===== -->
<div class="sticky top-14 z-40 bg-white border-b border-slate-100" style="box-shadow:0 2px 8px rgba(0,0,0,0.04);">
  <div class="max-w-6xl mx-auto px-4 py-3 space-y-2.5">
    <div class="flex items-center gap-2">
      <span class="text-xs font-bold text-slate-400 shrink-0 w-8">채널</span>
      <div class="filter-scroll flex gap-1.5">
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600 active" data-channel="전체">전체</button>
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-channel="블로그">📝 블로그</button>
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-channel="인스타">📸 인스타</button>
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-channel="릴스">🎞 릴스</button>
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-channel="유튜브">▶ 유튜브</button>
        <button class="channel-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-channel="클립">📎 클립</button>
      </div>
    </div>
    <div id="delivery-filter-row" class="flex items-center gap-2 hidden">
      <span class="text-xs font-bold text-slate-400 shrink-0 w-8">방식</span>
      <div class="filter-scroll flex gap-1.5">
        <button class="delivery-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600 active" data-delivery="전체">전체</button>
        <button class="delivery-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-delivery="배송형">📦 배송형</button>
        <button class="delivery-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-delivery="방문형">🚶 방문형</button>
        <button class="delivery-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-delivery="구매평">💳 구매평</button>
        <button class="delivery-btn filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600" data-delivery="재택형">🏠 재택형</button>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 flex-wrap">
        <button id="btn-today" onclick="toggleToday()" class="filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600">🆕 오늘 신규</button>
        <button id="btn-bookmarks" onclick="toggleBookmarks()" class="filter-chip px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 text-slate-600">♥ 즐겨찾기</button>
        <select id="platform-select" onchange="onPlatformChange()" class="text-xs rounded-full px-3 py-1.5 border border-slate-200 text-slate-600 outline-none bg-white font-bold cursor-pointer">
          <option value="전체">전체 사이트</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <span id="result-count" class="text-xs text-slate-400"></span>
        <select id="sort-select" onchange="onSortChange()" class="text-xs rounded-full px-3 py-1.5 border border-slate-200 text-slate-600 outline-none bg-white font-bold cursor-pointer">
          <option value="latest">최신순</option>
          <option value="applicants">모집인원 많은순</option>
        </select>
      </div>
    </div>
  </div>
</div>

<!-- ===== 캠페인 그리드 ===== -->
<main class="max-w-6xl mx-auto px-4 py-6">
  <div id="campaign-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <div class="skeleton rounded-2xl h-40"></div>
    <div class="skeleton rounded-2xl h-40"></div>
    <div class="skeleton rounded-2xl h-40"></div>
    <div class="skeleton rounded-2xl h-40"></div>
    <div class="skeleton rounded-2xl h-40"></div>
    <div class="skeleton rounded-2xl h-40"></div>
  </div>
  <div id="no-results" class="hidden text-center py-20">
    <div class="text-5xl mb-4">🔍</div>
    <p class="text-slate-500 font-bold text-lg">검색 결과가 없어요</p>
    <p class="text-slate-400 text-sm mt-1">다른 키워드나 필터를 사용해보세요</p>
  </div>
  <div id="load-more-wrap" class="flex justify-center mt-6 mb-4 hidden">
    <button id="load-more-btn" onclick="loadCampaigns(false)"
      class="px-8 py-3 rounded-xl text-white font-semibold hover:opacity-90 active:scale-95 transition-all text-sm shadow"
      style="background:#4f46e5;">
      더보기
    </button>
  </div>
</main>

<!-- ===== 캠페인 상세 모달 ===== -->
<div id="detail-modal" class="fixed inset-0 z-50 hidden" role="dialog" aria-modal="true">
  <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeModal()"></div>
  <div class="absolute inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div class="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl" style="max-height:90vh;overflow-y:auto;">
      <div class="sm:hidden flex justify-center pt-3 pb-1">
        <div class="w-10 h-1 bg-slate-200 rounded-full"></div>
      </div>
      <button onclick="closeModal()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-lg z-10">×</button>
      <div class="p-6 pb-8">
        <div class="flex flex-wrap items-center gap-2 mb-4" id="modal-badges"></div>
        <h2 id="modal-title" class="text-lg font-black text-slate-900 leading-snug mb-6"></h2>
        <div class="flex gap-3">
          <a id="modal-apply-btn" href="#" target="_blank" rel="noopener noreferrer"
            class="flex-1 flex items-center justify-center gap-2 text-white font-black py-4 rounded-2xl text-base transition-all hover:opacity-90 active:scale-95"
            style="background:linear-gradient(135deg,#6366f1,#4f46e5);">
            신청하러 가기 →
          </a>
          <button id="modal-share-btn" onclick="shareModal()"
            class="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl font-bold text-sm border-2 border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all active:scale-95 bg-white">
            🔗 공유
          </button>
        </div>
        <p class="text-center text-xs text-slate-400 mt-3">해당 체험단 플랫폼으로 이동합니다</p>
      </div>
    </div>
  </div>
</div>

<!-- ===== SEO 카테고리 섹션 ===== -->
<section class="bg-white border-t border-slate-100 py-12 px-4">
  <div class="max-w-4xl mx-auto">
    <h2 class="text-lg font-black text-slate-800 text-center mb-2">체험단 카테고리별 모아보기</h2>
    <p class="text-sm text-slate-400 text-center mb-8">블로그·인스타·유튜브 체험단을 카테고리별로 바로 검색하세요</p>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      <a href="<?php echo home_url('/?channel=블로그'); ?>" class="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center">
        <span class="text-3xl">📝</span>
        <span class="text-sm font-black text-slate-700">블로그 체험단</span>
        <span class="text-xs text-slate-400">네이버 블로그 리뷰</span>
      </a>
      <a href="<?php echo home_url('/?channel=인스타'); ?>" class="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center">
        <span class="text-3xl">📸</span>
        <span class="text-sm font-black text-slate-700">인스타 체험단</span>
        <span class="text-xs text-slate-400">인스타그램·릴스</span>
      </a>
      <a href="<?php echo home_url('/?q=뷰티'); ?>" class="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center">
        <span class="text-3xl">💄</span>
        <span class="text-sm font-black text-slate-700">뷰티 체험단</span>
        <span class="text-xs text-slate-400">화장품·스킨케어</span>
      </a>
      <a href="<?php echo home_url('/?q=맛집'); ?>" class="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center">
        <span class="text-3xl">🍽</span>
        <span class="text-sm font-black text-slate-700">식품·맛집 체험단</span>
        <span class="text-xs text-slate-400">음식·카페·배달</span>
      </a>
      <a href="<?php echo home_url('/?delivery=방문형'); ?>" class="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center">
        <span class="text-3xl">🚶</span>
        <span class="text-sm font-black text-slate-700">방문 체험단</span>
        <span class="text-xs text-slate-400">맛집·헤어샵·카페</span>
      </a>
    </div>
  </div>
</section>

<!-- ===== FAQ ===== -->
<section class="bg-slate-50 border-t border-slate-100 py-12 px-4">
  <div class="max-w-2xl mx-auto">
    <h2 class="text-base font-black text-slate-600 text-center mb-5">자주 묻는 질문</h2>
    <div class="space-y-2">
      <details class="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <summary class="cursor-pointer px-5 py-4 font-bold text-sm text-slate-700 select-none">캠레이더는 무엇인가요?</summary>
        <div class="px-5 pb-4 text-sm text-slate-500 leading-relaxed">블로그체험단·인스타체험단·유튜브체험단을 37개 사이트에서 한번에 검색할 수 있는 무료 모아보기 서비스입니다. 1시간마다 자동 수집합니다.</div>
      </details>
      <details class="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <summary class="cursor-pointer px-5 py-4 font-bold text-sm text-slate-700 select-none">블로그 체험단은 어떻게 신청하나요?</summary>
        <div class="px-5 pb-4 text-sm text-slate-500 leading-relaxed">원하는 캠페인 카드를 클릭해 상세 정보를 확인한 뒤 <strong>신청하러 가기</strong> 버튼으로 해당 플랫폼에서 직접 신청하세요.</div>
      </details>
      <details class="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <summary class="cursor-pointer px-5 py-4 font-bold text-sm text-slate-700 select-none">인스타체험단·유튜브체험단도 검색되나요?</summary>
        <div class="px-5 pb-4 text-sm text-slate-500 leading-relaxed">네, 채널 필터에서 인스타·릴스·유튜브·클립을 선택하면 해당 채널의 체험단만 모아볼 수 있습니다.</div>
      </details>
      <details class="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <summary class="cursor-pointer px-5 py-4 font-bold text-sm text-slate-700 select-none">이용 비용이 있나요?</summary>
        <div class="px-5 pb-4 text-sm text-slate-500 leading-relaxed">완전 무료입니다. 로그인 없이 바로 검색하고 즐겨찾기를 사용할 수 있습니다.</div>
      </details>
    </div>
  </div>
</section>

<script>
// WordPress REST API에서 캠페인 데이터 로드
const WP_API = '<?php echo esc_url(rest_url("camradar/v1")); ?>';
const WP_REST = '<?php echo esc_url(rest_url("wp/v2")); ?>';

let allCampaigns = [];
let filteredCampaigns = [];
let displayedCount = 0;
const PAGE_SIZE = 30;

let activeChannel = '전체';
let activeDelivery = '전체';
let activePlatform = '전체';
let showTodayOnly = false;
let showBookmarksOnly = false;
let sortMode = 'latest';
let searchQuery = '';

const bookmarks = JSON.parse(localStorage.getItem('camradar_bookmarks') || '[]');
const today = new Date().toISOString().slice(0, 10);

// WP REST API로 캠페인 로드
async function fetchCampaigns() {
  try {
    const res = await fetch(WP_REST + '/campaigns?per_page=100&status=publish&orderby=date&order=desc&_fields=id,title,meta,date');
    const data = await res.json();

    allCampaigns = data.map(p => ({
      id: p.id,
      title: p.title.rendered,
      platform_name: p.meta.platform_name || '',
      campaign_url: p.meta.campaign_url || '#',
      channel: p.meta.channel || '블로그',
      delivery_type: p.meta.delivery_type || '',
      capacity: p.meta.capacity || 0,
      applicants: p.meta.applicants || 0,
      deadline_text: p.meta.deadline_text || '',
      deadline_date: p.meta.deadline_date || '',
      date: p.date ? p.date.slice(0, 10) : '',
    }));

    updateStats();
    applyFilters();
  } catch (e) {
    console.error('캠페인 로드 오류:', e);
    document.getElementById('campaign-grid').innerHTML = '<p class="col-span-3 text-center text-slate-400 py-10">데이터를 불러오는 중 오류가 발생했습니다.</p>';
  }
}

function updateStats() {
  document.getElementById('stat-total').textContent = allCampaigns.length.toLocaleString();
  const todayCnt = allCampaigns.filter(c => c.date === today).length;
  document.getElementById('stat-today').textContent = todayCnt.toLocaleString();

  const platforms = [...new Set(allCampaigns.map(c => c.platform_name).filter(Boolean))];
  document.getElementById('stat-platforms').textContent = platforms.length || '37+';

  const platformSelect = document.getElementById('platform-select');
  platforms.sort().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    platformSelect.appendChild(opt);
  });

  const hasDelivery = allCampaigns.some(c => c.delivery_type);
  if (hasDelivery) document.getElementById('delivery-filter-row').classList.remove('hidden');
}

function applyFilters() {
  let results = [...allCampaigns];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    results = results.filter(c => c.title.toLowerCase().includes(q) || (c.platform_name || '').toLowerCase().includes(q));
  }
  if (activeChannel !== '전체') results = results.filter(c => c.channel === activeChannel);
  if (activeDelivery !== '전체') results = results.filter(c => c.delivery_type === activeDelivery);
  if (activePlatform !== '전체') results = results.filter(c => c.platform_name === activePlatform);
  if (showTodayOnly) results = results.filter(c => c.date === today);
  if (showBookmarksOnly) results = results.filter(c => bookmarks.includes(String(c.id)));

  if (sortMode === 'applicants') results.sort((a, b) => (b.applicants || 0) - (a.applicants || 0));

  filteredCampaigns = results;
  displayedCount = 0;
  document.getElementById('result-count').textContent = results.length + '개';
  renderCampaigns(true);
}

function renderCampaigns(reset) {
  const grid = document.getElementById('campaign-grid');
  if (reset) grid.innerHTML = '';

  if (filteredCampaigns.length === 0) {
    document.getElementById('no-results').classList.remove('hidden');
    document.getElementById('load-more-wrap').classList.add('hidden');
    return;
  }
  document.getElementById('no-results').classList.add('hidden');

  const slice = filteredCampaigns.slice(displayedCount, displayedCount + PAGE_SIZE);
  displayedCount += slice.length;

  slice.forEach(c => {
    const card = document.createElement('div');
    card.className = 'campaign-card bg-white rounded-2xl border border-slate-100 p-4 cursor-pointer';
    card.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
    card.onclick = () => openModal(c);

    const isBookmarked = bookmarks.includes(String(c.id));
    const channelEmoji = { '블로그': '📝', '인스타': '📸', '릴스': '🎞', '유튜브': '▶', '클립': '📎' }[c.channel] || '📋';
    const deadlineHtml = c.deadline_text ? `<span class="text-xs text-slate-400">마감 ${c.deadline_text}</span>` : '';
    const capacityHtml = c.capacity ? `<span class="text-xs font-bold text-indigo-600">${c.capacity}명 모집</span>` : '';

    card.innerHTML = `
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600">${channelEmoji} ${c.channel}</span>
          ${c.delivery_type ? `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500">${c.delivery_type}</span>` : ''}
          ${c.platform_name ? `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-400 border border-slate-100">${c.platform_name}</span>` : ''}
        </div>
        <button onclick="event.stopPropagation();toggleBookmark('${c.id}',this)" class="text-lg leading-none ${isBookmarked ? 'text-red-400' : 'text-slate-200'} hover:text-red-400 transition-colors">${isBookmarked ? '♥' : '♡'}</button>
      </div>
      <h3 class="font-black text-slate-900 text-sm leading-snug mb-3 line-clamp-2">${c.title}</h3>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">${capacityHtml}${deadlineHtml}</div>
        ${c.date === today ? '<span class="px-1.5 py-0.5 rounded text-2xs font-bold bg-green-50 text-green-600 border border-green-100">NEW</span>' : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  document.getElementById('load-more-wrap').classList.toggle('hidden', displayedCount >= filteredCampaigns.length);
}

let currentModalCampaign = null;

function openModal(c) {
  currentModalCampaign = c;
  const channelEmoji = { '블로그': '📝', '인스타': '📸', '릴스': '🎞', '유튜브': '▶', '클립': '📎' }[c.channel] || '📋';
  const badges = document.getElementById('modal-badges');
  badges.innerHTML = `
    <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600">${channelEmoji} ${c.channel}</span>
    ${c.delivery_type ? `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">${c.delivery_type}</span>` : ''}
    ${c.platform_name ? `<span class="px-2.5 py-1 rounded-full text-xs bg-slate-50 text-slate-400 border border-slate-100">${c.platform_name}</span>` : ''}
    ${c.capacity ? `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600">${c.capacity}명 모집</span>` : ''}
    ${c.deadline_text ? `<span class="px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-600 border border-amber-100">마감 ${c.deadline_text}</span>` : ''}
  `;
  document.getElementById('modal-title').textContent = c.title;
  document.getElementById('modal-apply-btn').href = c.campaign_url;
  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function shareModal() {
  if (!currentModalCampaign) return;
  const text = currentModalCampaign.title + ' - 캠레이더에서 찾아보세요!';
  if (navigator.share) {
    navigator.share({ title: text, url: window.location.href });
  } else {
    navigator.clipboard.writeText(window.location.href).then(() => alert('링크가 복사되었습니다!'));
  }
}

function toggleBookmark(id, btn) {
  const idx = bookmarks.indexOf(String(id));
  if (idx > -1) {
    bookmarks.splice(idx, 1);
    btn.textContent = '♡';
    btn.classList.remove('text-red-400');
    btn.classList.add('text-slate-200');
  } else {
    bookmarks.push(String(id));
    btn.textContent = '♥';
    btn.classList.add('text-red-400');
    btn.classList.remove('text-slate-200');
  }
  localStorage.setItem('camradar_bookmarks', JSON.stringify(bookmarks));
}

function toggleToday() {
  showTodayOnly = !showTodayOnly;
  document.getElementById('btn-today').classList.toggle('active', showTodayOnly);
  applyFilters();
}

function toggleBookmarks() {
  showBookmarksOnly = !showBookmarksOnly;
  document.getElementById('btn-bookmarks').classList.toggle('active', showBookmarksOnly);
  applyFilters();
}

function onPlatformChange() {
  activePlatform = document.getElementById('platform-select').value;
  applyFilters();
}

function onSortChange() {
  sortMode = document.getElementById('sort-select').value;
  applyFilters();
}

// 채널 필터
document.querySelectorAll('.channel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeChannel = btn.dataset.channel;
    applyFilters();
  });
});

// 방식 필터
document.querySelectorAll('.delivery-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.delivery-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeDelivery = btn.dataset.delivery;
    applyFilters();
  });
});

// 검색
document.getElementById('search-btn').addEventListener('click', () => {
  searchQuery = document.getElementById('search-input').value.trim();
  applyFilters();
});
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('search-btn').click();
});

// URL 파라미터 처리
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('q')) {
  document.getElementById('search-input').value = urlParams.get('q');
  searchQuery = urlParams.get('q');
}
if (urlParams.get('channel')) {
  activeChannel = urlParams.get('channel');
  document.querySelectorAll('.channel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.channel === activeChannel);
  });
}

// 인기 검색어
const popularKeywords = ['뷰티', '맛집', '식품', '강아지', '생활용품', '카페', '헬스', '다이어트'];
const tagsEl = document.getElementById('popular-tags');
popularKeywords.forEach(kw => {
  const btn = document.createElement('button');
  btn.className = 'px-3 py-1.5 rounded-full text-xs bg-white border border-indigo-100 text-indigo-600 font-bold hover:bg-indigo-50 transition-colors';
  btn.textContent = kw;
  btn.onclick = () => {
    document.getElementById('search-input').value = kw;
    searchQuery = kw;
    applyFilters();
  };
  tagsEl.appendChild(btn);
});

// 초기 로드
fetchCampaigns();
</script>

<?php get_footer(); ?>
