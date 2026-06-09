import { token } from './state.js';
import { createThumbnail } from './ui.js';
import { playMusic } from './player.js';

let allKeywordsData = [];

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
}

export async function loadAdminKeywords() {
  if (!token) return;
  try {
    const res = await fetch(`/api/admin/keywords?token=${token}`);
    if (res.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /dashboard 명령어를 다시 입력해주세요.');
      return;
    }
    const data = await res.json();
    if (data.ok) {
      allKeywordsData = data.keywords || [];

      renderBlacklistChips(data.blacklist || []);
      renderKeywordsTable(allKeywordsData);
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
      body: JSON.stringify({ token, keyword }),
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
      body: JSON.stringify({ token, keyword }),
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
