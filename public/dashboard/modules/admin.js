import { token } from './state.js';
import { createThumbnail } from './ui.js';
import { playMusic } from './player.js';

let allKeywordsData = [];
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
    } else {
      btnServer.classList.remove('active');
      btnPersonal.classList.add('active');
    }
  }
  loadAdminKeywords();
}

export async function loadAdminKeywords() {
  if (!token) return;
  try {
    const res = await fetch(`/api/admin/keywords?token=${token}&mode=${currentKeywordMode}`);
    if (res.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /dashboard 명령어를 다시 입력해주세요.');
      return;
    }
    const data = await res.json();
    if (data.ok) {
      allKeywordsData = data.keywords || [];

      renderBlacklistChips(data.blacklist || []);
      renderKeywordsTable(allKeywordsData);
      renderRecommendationResult(data.recommendation || null);
    }
  }
  catch (err) {
    console.error('키워드 데이터 로드 실패:', err);
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

  keywords.forEach((item, index) => {
    const tr = document.createElement('tr');

    const tdRank = document.createElement('td');
    tdRank.textContent = String(index + 1);
    tdRank.style.color = index < 3 ? 'var(--red-bright)' : 'var(--text-muted)';
    tdRank.style.fontWeight = index < 3 ? '700' : '400';

    const tdTag = document.createElement('td');
    tdTag.textContent = item.tag;
    tdTag.style.fontWeight = '500';

    const tdFreq = document.createElement('td');
    tdFreq.textContent = `${item.freq}회`;

    const tdManage = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'keyword-btn-remove';
    btn.textContent = '제거';
    btn.onclick = () => addBlacklist(item.tag);
    tdManage.appendChild(btn);

    tr.append(tdRank, tdTag, tdFreq, tdManage);
    tbody.appendChild(tr);
  });
}

export async function addBlacklist(keyword) {
  if (!keyword || !token) return;
  try {
    const res = await fetch('/api/admin/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, keyword, mode: currentKeywordMode }),
    });
    const data = await res.json();
    if (data.ok) {
      loadAdminKeywords();
    }
    else {
      alert(data.error || '차단 실패');
    }
  }
  catch (err) {
    console.error('차단 요청 실패:', err);
  }
}

export async function removeBlacklist(keyword) {
  if (!keyword || !token) return;
  try {
    const res = await fetch('/api/admin/blacklist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, keyword, mode: currentKeywordMode }),
    });
    const data = await res.json();
    if (data.ok) {
      loadAdminKeywords();
    }
    else {
      alert(data.error || '차단 해제 실패');
    }
  }
  catch (err) {
    console.error('차단 해제 요청 실패:', err);
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
    const res = await fetch(`/api/admin/search-preview?token=${token}&keyword=${encodeURIComponent(keyword)}`);
    const data = await res.json();
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
    thumb.appendChild(createThumbnail(item.thumbnail, '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'));

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
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    playBtn.title = '대시보드에서 재생';
    playBtn.onclick = () => playMusic(item.url);

    const linkBtn = document.createElement('button');
    linkBtn.className = 'qa-btn';
    linkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
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
  if (!recommendation || !recommendation.keyword) {
    titleEl.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--red)" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${modeLabel} 추천 곡 미리보기`;
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0; width: 100%;">충분한 키워드 데이터가 쌓이면 추천 곡이 나타납니다.</div>';
    return;
  }

  titleEl.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--red)" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${modeLabel} 추천 곡 미리보기 (키워드: #${recommendation.keyword})`;

  const items = recommendation.items || [];
  if (items.length === 0) {
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0; width: 100%;">추천 검색 결과가 없습니다.</div>';
    return;
  }

  const displayItems = items.slice(0, 5);

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
    overlay.onclick = () => playMusic(item.url);

    const playCircle = document.createElement('div');
    playCircle.className = 'card-play-btn-circle';
    playCircle.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
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
    viewBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> 유튜브에서 열기';
    viewBtn.onclick = () => window.open(item.url, '_blank');

    actionsContainer.appendChild(viewBtn);

    card.append(thumbContainer, infoContainer, actionsContainer);
    container.appendChild(card);
  });
}
