import { api } from './api.js';
import { token } from './state.js';
import { createThumbnail, showToast } from './ui.js';
import { playMusic } from './player.js';
import { getIcon } from './icons.js';

let allKeywordsData = [];
let allBlacklistData = [];
let currentKeywordMode = 'server';

export function switchTab(tab) {
  const menuDashboard = document.getElementById('menu-dashboard');
  const menuAdmin = document.getElementById('menu-admin');
  const dashboardView = document.getElementById('dashboard-view');
  const adminView = document.getElementById('admin-view');

  if (tab === 'dashboard') {
    menuDashboard.classList.add('active');
    menuAdmin.classList.remove('active');
    dashboardView.style.display = 'block';
    adminView.style.display = 'none';
  }
  else if (tab === 'admin') {
    menuDashboard.classList.remove('active');
    menuAdmin.classList.add('active');
    dashboardView.style.display = 'none';
    adminView.style.display = 'block';
    loadAdminKeywords();
  }

  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }
}

export function setKeywordMode(mode) {
  currentKeywordMode = mode;
  const btnServer = document.getElementById('btn-mode-server');
  const btnPersonal = document.getElementById('btn-mode-personal');
  if (btnServer && btnPersonal) {
    if (mode === 'server') {
      btnServer.classList.add('active');
      btnPersonal.classList.remove('active');
    }
    else {
      btnServer.classList.remove('active');
      btnPersonal.classList.add('active');
    }
  }
  loadAdminKeywords();
}

export async function loadAdminKeywords(showLoading = true) {
  if (!token) return;

  const chipsContainer = document.getElementById('blacklistChips');
  const tableBody = document.getElementById('keywordTableBody');
  const recommendationContainer = document.getElementById('recommendationResultContainer');

  // API 요청 전 로딩 상태 표시 (showLoading이 true일 때만 노출)
  if (showLoading) {
    if (chipsContainer) {
      chipsContainer.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div></div>';
    }
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="4"><div class="loading-container"><div class="loading-spinner"></div></div></td></tr>';
    }
    if (recommendationContainer) {
      recommendationContainer.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div></div>';
    }
  }

  try {
    const data = await api.fetchKeywords(currentKeywordMode);
    if (data.ok) {
      allKeywordsData = data.keywords || [];
      allBlacklistData = data.blacklist || [];
      allBlacklistData.sort();

      renderBlacklistChips(allBlacklistData);
      renderKeywordsTable(allKeywordsData);
      renderRecommendationResult(data.recommendation || null);
    }
  }
  catch (err) {
    console.error('키워드 데이터 로드 실패:', err);
    if (chipsContainer) {
      chipsContainer.innerHTML = '<div style="color: var(--red); font-size: 13px; padding: 10px 0;">로딩 실패</div>';
    }
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--red); padding: 20px;">로딩 실패</td></tr>';
    }
    if (recommendationContainer) {
      recommendationContainer.innerHTML = '<div style="color: var(--red); font-size: 13px; text-align: center; padding: 40px 0;">로딩 실패</div>';
    }
  }
}

export function renderBlacklistChips(blacklist) {
  const container = document.getElementById('blacklistChips');
  container.innerHTML = '';

  if (blacklist.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 10px 0;">차단된 키워드가 없습니다.</div>';
    return;
  }

  blacklist.forEach(keyword => {
    const chip = document.createElement('div');
    chip.className = 'blacklist-chip';
    chip.textContent = keyword;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'blacklist-chip-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => removeBlacklist(keyword);

    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

export function renderKeywordsTable(keywords) {
  const tbody = document.getElementById('keywordTableBody');
  tbody.innerHTML = '';

  if (keywords.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">수집된 키워드가 없습니다.</td></tr>';
    return;
  }

  // 1. 고정 키워드를 최상단에, 그 다음 빈도수 내림차순 정렬
  const sortedKeywords = [...keywords].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.freq - a.freq || a.tag.localeCompare(b.tag);
  });

  sortedKeywords.forEach((item, index) => {
    const tr = document.createElement('tr');
    if (item.isPinned) {
      tr.style.background = 'rgba(235, 87, 87, 0.05)'; // 고정 키워드 행 배경색 변경 (약한 빨간색 하이라이트)
    }

    const tdRank = document.createElement('td');
    tdRank.textContent = String(index + 1);
    tdRank.style.color = index < 3 ? 'var(--red-bright)' : 'var(--text-muted)';
    tdRank.style.fontWeight = index < 3 ? '700' : '400';

    const tdTag = document.createElement('td');
    tdTag.style.fontWeight = '500';
    tdTag.style.display = 'flex';
    tdTag.style.alignItems = 'center';
    tdTag.style.gap = '6px';
    
    // 키워드 이름 노출
    const spanText = document.createElement('span');
    spanText.textContent = item.tag;
    tdTag.appendChild(spanText);

    // 고정된 키워드면 제목 옆에 '못 아이콘' 표시
    if (item.isPinned) {
      const pinIconSpan = document.createElement('span');
      pinIconSpan.style.color = 'var(--red)';
      pinIconSpan.innerHTML = getIcon('pin');
      pinIconSpan.title = '고정됨';
      tdTag.appendChild(pinIconSpan);
    }

    const tdFreq = document.createElement('td');
    tdFreq.textContent = `${item.freq}회`;

    const tdManage = document.createElement('td');
    tdManage.style.display = 'flex';
    tdManage.style.gap = '8px';

    // 1. 고정/해제 토글 버튼
    const pinBtn = document.createElement('button');
    pinBtn.style.padding = '4px 8px';
    pinBtn.style.fontSize = '12px';
    pinBtn.style.borderRadius = '4px';
    pinBtn.style.border = 'none';
    pinBtn.style.cursor = 'pointer';
    
    if (item.isPinned) {
      pinBtn.className = 'keyword-btn-pin active';
      pinBtn.textContent = '해제';
      pinBtn.style.background = 'var(--red-muted)';
      pinBtn.style.color = '#fff';
      pinBtn.onclick = () => togglePin(item.tag, true);
    } else {
      pinBtn.className = 'keyword-btn-pin';
      pinBtn.textContent = '고정';
      pinBtn.style.background = 'var(--bg-card-hover)';
      pinBtn.style.color = 'var(--text)';
      pinBtn.onclick = () => togglePin(item.tag, false);
    }
    
    // 2. 제거 버튼
    const removeBtn = document.createElement('button');
    removeBtn.className = 'keyword-btn-remove';
    removeBtn.textContent = '제거';
    removeBtn.onclick = () => addBlacklist(item.tag);

    tdManage.append(pinBtn, removeBtn);

    tr.append(tdRank, tdTag, tdFreq, tdManage);
    tbody.appendChild(tr);
  });
}

// togglePin 함수 신규 구현 (낙관적 업데이트 적용)
export async function togglePin(keyword, isCurrentlyPinned) {
  if (!keyword || !token) return;

  const backupKeywords = [...allKeywordsData];

  // 고정 제한 5개 체크 (고정을 요청하는 경우만 검사)
  if (!isCurrentlyPinned) {
    const pinnedCount = allKeywordsData.filter(item => item.isPinned).length;
    if (pinnedCount >= 5) {
      showToast('최대 5개까지만 고정할 수 있습니다.');
      return;
    }
  }

  // 낙관적 업데이트: 로컬 데이터 상태를 즉시 토글
  allKeywordsData = allKeywordsData.map(item => {
    if (item.tag === keyword) {
      return { ...item, isPinned: !isCurrentlyPinned };
    }
    return item;
  });
  renderKeywordsTable(allKeywordsData);

  try {
    let res;
    if (isCurrentlyPinned) {
      res = await api.removePin(keyword, currentKeywordMode);
    } else {
      res = await api.addPin(keyword, currentKeywordMode);
    }

    if (res.ok) {
      showToast(`키워드 '${keyword}' ${isCurrentlyPinned ? '고정을 해제했습니다.' : '고정했습니다.'}`);
      loadAdminKeywords(false); // 백그라운드 갱신
    } else {
      // 실패 시 원래대로 복구
      allKeywordsData = backupKeywords;
      renderKeywordsTable(allKeywordsData);
      showToast(res.error || '고정 상태를 변경하는 데 실패했습니다.');
    }
  } catch (err) {
    console.error('고정 요청 오류:', err);
    allKeywordsData = backupKeywords;
    renderKeywordsTable(allKeywordsData);
  }
}

export async function addBlacklist(keyword) {
  if (!keyword || !token) return;

  // 1. 실패 시 복구를 위한 상태 백업
  const backupKeywords = [...allKeywordsData];
  const backupBlacklist = [...allBlacklistData];

  // 2. 상태 변경 (낙관적 업데이트)
  allKeywordsData = allKeywordsData.filter(item => item.tag !== keyword);
  if (!allBlacklistData.includes(keyword)) {
    allBlacklistData.push(keyword);
  }

  // 3. UI 즉시 반영
  renderBlacklistChips(allBlacklistData);
  renderKeywordsTable(allKeywordsData);

  try {
    const data = await api.addBlacklist(keyword, currentKeywordMode);
    if (data.ok) {
      showToast(`키워드 '${keyword}'(을)를 차단했습니다.`);
      // 백그라운드 갱신 (스피너 비활성화)
      loadAdminKeywords(false);
    }
    else {
      // 실패 시 롤백 및 에러 알림
      allKeywordsData = backupKeywords;
      allBlacklistData = backupBlacklist;
      renderBlacklistChips(allBlacklistData);
      renderKeywordsTable(allKeywordsData);
      alert(data.error || '차단 실패');
    }
  }
  catch (err) {
    console.error('차단 요청 실패:', err);
    // 실패 시 롤백
    allKeywordsData = backupKeywords;
    allBlacklistData = backupBlacklist;
    renderBlacklistChips(allBlacklistData);
    renderKeywordsTable(allKeywordsData);
  }
}

export async function removeBlacklist(keyword) {
  if (!keyword || !token) return;

  // 1. 실패 시 복구를 위한 상태 백업
  const backupBlacklist = [...allBlacklistData];

  // 2. 상태 변경 (낙관적 업데이트: 칩 목록에서 즉시 제거)
  allBlacklistData = allBlacklistData.filter(item => item !== keyword);

  // 3. UI 즉시 반영
  renderBlacklistChips(allBlacklistData);

  try {
    const data = await api.removeBlacklist(keyword, currentKeywordMode);
    if (data.ok) {
      showToast(`키워드 '${keyword}' 차단을 해제했습니다.`);
      // 백그라운드 갱신 (스피너 없이 테이블 복구)
      loadAdminKeywords(false);
    }
    else {
      // 실패 시 롤백 및 에러 알림
      allBlacklistData = backupBlacklist;
      renderBlacklistChips(allBlacklistData);
      alert(data.error || '차단 해제 실패');
    }
  }
  catch (err) {
    console.error('차단 해제 요청 실패:', err);
    // 실패 시 롤백
    allBlacklistData = backupBlacklist;
    renderBlacklistChips(allBlacklistData);
  }
}

export function addBlacklistFromInput() {
  const input = document.getElementById('blacklist-input');
  const keyword = input.value.trim();
  if (!keyword) return;
  addBlacklist(keyword);
  input.value = '';
}

export function filterKeywordsTable() {
  const query = document.getElementById('keyword-search-input').value.toLowerCase().trim();
  if (!query) {
    renderKeywordsTable(allKeywordsData);
    return;
  }
  const filtered = allKeywordsData.filter(item => item.tag.toLowerCase().includes(query));
  renderKeywordsTable(filtered);
}

export async function searchPreviewKeywords() {
  const input = document.getElementById('preview-search-input');
  const keyword = input.value.trim();
  if (!keyword) return;

  const container = document.getElementById('previewResultContainer');
  container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0;">유튜브 검색 결과를 가져오는 중...</div>';

  try {
    const data = await api.searchPreview(keyword);
    if (data.ok) {
      renderPreviewResult(data.items || []);
    }
    else {
      container.innerHTML = `<div style="color: var(--red); font-size: 13px; text-align: center; padding: 40px 0;">검색 오류: ${data.error || '알 수 없음'}</div>`;
    }
  }
  catch (err) {
    console.error('검색 미리보기 실패:', err);
    container.innerHTML = '<div style="color: var(--red); font-size: 13px; text-align: center; padding: 40px 0;">네트워크 오류가 발생했습니다.</div>';
  }
}

export function renderPreviewResult(items) {
  const container = document.getElementById('previewResultContainer');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0;">검색 결과가 없습니다.</div>';
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';

    const num = document.createElement('div');
    num.className = 'queue-num';
    num.textContent = String(index + 1);

    const thumb = document.createElement('div');
    thumb.className = 'queue-thumb';
    thumb.appendChild(createThumbnail(item.thumbnail, getIcon('music')));

    const info = document.createElement('div');
    info.className = 'queue-info';

    const title = document.createElement('div');
    title.className = 'queue-title';
    title.textContent = item.title;

    const artist = document.createElement('div');
    artist.className = 'queue-artist';
    artist.textContent = item.artist;

    info.append(title, artist);

    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    const playBtn = document.createElement('button');
    playBtn.className = 'qa-btn';
    playBtn.style.color = 'var(--red)';
    playBtn.innerHTML = getIcon('play');
    playBtn.title = '대시보드에서 재생';
    playBtn.onclick = () => playMusic(item.url);

    const linkBtn = document.createElement('button');
    linkBtn.className = 'qa-btn';
    linkBtn.innerHTML = getIcon('link');
    linkBtn.title = '유튜브에서 열기';
    linkBtn.onclick = () => window.open(item.url, '_blank');

    actions.append(playBtn, linkBtn);
    row.append(num, thumb, info, actions);
    container.appendChild(row);
  });
}

export function renderRecommendationResult(recommendation) {
  const titleEl = document.getElementById('recommendationCardTitle');
  const container = document.getElementById('recommendationResultContainer');
  if (!titleEl || !container) return;
  container.innerHTML = '';

  const modeLabel = currentKeywordMode === 'personal' ? '나를 위한' : '서버';

  titleEl.innerHTML = `${getIcon('recommend')} ${modeLabel} 추천 곡 미리보기`;
  if (!recommendation) {
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0; width: 100%;">충분한 키워드 데이터가 쌓이면 추천 곡이 나타납니다.</div>';
    return;
  }


  const items = recommendation.items || [];
  if (items.length === 0) {
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0; width: 100%;">추천 검색 결과가 없습니다.</div>';
    return;
  }

  const displayItems = items.slice(0, 10);
  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  displayItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'recommend_item_card';

    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'card-thumb';

    const img = document.createElement('img');
    img.src = item.thumbnail || 'https://images.unsplash.com/photo-1614680376593-902f74fa0d41?q=80&w=300';
    img.alt = item.title;

    const overlay = document.createElement('div');
    overlay.className = 'card-play-overlay';

    overlay.onclick = (e) => {
      if (isTouch) {
        e.stopPropagation();
        if (!card.classList.contains('touched')) {
          document.querySelectorAll('.recommend_item_card').forEach(c => c.classList.remove('touched'));
          card.classList.add('touched');
        }
        else if (e.target.closest('.card-play-btn-circle')) {
          playMusic(item.url);
        }
        else {
            card.classList.remove('touched');
        }
      }
      else {
        playMusic(item.url);
      }
    };

    const playCircle = document.createElement('div');
    playCircle.className = 'card-play-btn-circle';
    playCircle.innerHTML = getIcon('play');
    overlay.appendChild(playCircle);

    thumbContainer.append(img, overlay);

    const infoContainer = document.createElement('div');
    infoContainer.className = 'card-info';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.title;
    title.title = item.title;

    const artist = document.createElement('div');
    artist.className = 'card-artist';
    artist.textContent = item.artist;
    artist.title = item.artist;

    infoContainer.append(title, artist);

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'card-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'card-action-btn';
    viewBtn.innerHTML = `${getIcon('link')} 유튜브에서 열기`;
    viewBtn.onclick = () => window.open(item.url, '_blank');

    actionsContainer.appendChild(viewBtn);

    card.append(thumbContainer, infoContainer, actionsContainer);
    container.appendChild(card);
  });
}

if (window.matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('click', () => {
    document.querySelectorAll('.recommend_item_card').forEach(c => c.classList.remove('touched'));
  }, { passive: true });
}
