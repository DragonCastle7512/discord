const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

const dashboardData = {
  server: { guildId: null, name: '연결 중...', channelName: '...', serverIcon: null, userIcon: null },
  musicInfo: { currentMusic: null, queue: [], trending: [], playlists: [] },
  stats: { queueCount: 0, todayPlays: 0, playlistCount: 0, existCurrentMusic: false },
};

let socket = null;

function initSocketConnection(guildId, userId) {
  if (socket || (!guildId && !userId)) return;

  socket = io({ query: { guildId, userId } });

  socket.on('musicUpdate', ({ type }) => {
    fetchDashboardData(type || 'all');
  });
}

// --- 전역 타이머 관리 (진행 바 보간) ---
let progressInterval = null;
let currentPos = 0;
let totalDuration = 0;
let isPlaying = false;

function startProgressTimer() {
  if (progressInterval) clearInterval(progressInterval);

  progressInterval = setInterval(() => {
    if (!isPlaying || currentPos >= totalDuration) return;

    currentPos += 200;
    updateProgressBarUI();
  }, 200);
}

function updateProgressBarUI() {
  const progressStart = document.querySelector('.progress-times span:first-child');
  const progressFill = document.querySelector('.progress-fill');
  const progressDot = document.querySelector('.progress-dot');

  if (progressStart) progressStart.textContent = formatTime(currentPos);

  const progress = (currentPos / (totalDuration || 1)) * 100;
  if (progressFill) progressFill.style.width = `${Math.min(progress, 100)}%`;
  if (progressDot) progressDot.style.left = `${Math.min(progress, 100)}%`;
}

// --- Drag & Drop 관리 ---
let draggedItem = null;
let draggedType = null;
let lastTouchTarget = null;

function setDraggingState(active) {
  if (active) document.body.classList.add('is-dragging');
  else document.body.classList.remove('is-dragging');
}

function handleDragStart(e, type, index) {
  draggedItem = index;
  draggedType = type;
  setDraggingState(true);
  e.currentTarget.style.opacity = '0.4';
  // e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  setDraggingState(false);
  e.currentTarget.style.opacity = '1';
  document.querySelectorAll('.queue-item, .pl-card').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  // e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
  return false;
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, type, toIndex) {
  // if (e.preventDefault) e.preventDefault();
  if (e.stopPropagation) e.stopPropagation();
  setDraggingState(false);

  document.querySelectorAll('.queue-item, .pl-card').forEach(el => el.classList.remove('drag-over'));

  if (draggedItem === null || draggedType !== type || draggedItem === toIndex) return;

  const fromIndex = draggedItem;
  draggedItem = null;

  try {
    const res = await fetch('/api/move-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, type, from: fromIndex, to: toIndex }),
    });
    if (!res.ok) console.error('이동 실패');
  }
  catch (err) {
    console.error('이동 요청 오류:', err);
  }
}

async function deleteItem(type, index) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  try {
    const res = await fetch('/api/delete-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, type, index }),
    });
    if (!res.ok) console.error('삭제 실패');
  }
  catch (err) {
    console.error('삭제 요청 오류:', err);
  }
}

async function playMusic(url) {
  try {
    const res = await fetch('/api/play-music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, url }),
    });
    const result = await res.json();
    if (!result.ok) alert(result.message || '재생 요청에 실패했습니다.');
  }
  catch (err) {
    console.error('재생 요청 오류:', err);
  }
}

async function sendControl(action) {
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action }),
    });
    const result = await res.json();
    if (result.ok && action === 'shuffle') fetchDashboardData('queue');
    if (!result.ok) console.error(`${action} 실패:`, result.message);
  }
  catch (err) {
    console.error(`${action} 요청 오류:`, err);
  }
}

function setupTouchEvents(el, type, index) {
  el.addEventListener('touchstart', () => {
    draggedItem = index;
    draggedType = type;
    el.style.opacity = '0.4';
    setDraggingState(true);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (draggedItem === null) return;

    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = target?.closest('.queue-item, .pl-card');

    document.querySelectorAll('.queue-item, .pl-card').forEach(i => i.classList.remove('drag-over'));
    if (item && draggedType === (item.classList.contains('queue-item') ? 'queue' : 'playlist')) {
      item.classList.add('drag-over');
      lastTouchTarget = item;
    }
  }, { passive: false });

  el.addEventListener('touchend', async (e) => {
    el.style.opacity = '1';
    setDraggingState(false);
    if (lastTouchTarget) {
      const parent = lastTouchTarget.parentNode;
      const toIndex = Array.from(parent.children).indexOf(lastTouchTarget);
      lastTouchTarget.classList.remove('drag-over');
      await handleDrop(e, type, toIndex);
    }
    draggedItem = null;
    lastTouchTarget = null;
  }, { passive: true });
}

function mergeDashboardData(newData, type) {
  if (newData.server && newData.server.guildId) {
    dashboardData.server = { ...dashboardData.server, ...newData.server };
  }

  if (newData.musicInfo) {
    if (newData.musicInfo.currentMusic !== null) {
      const cm = newData.musicInfo.currentMusic;
      dashboardData.musicInfo.currentMusic = cm;
      currentPos = cm.position;
      totalDuration = cm.duration || 0;
      isPlaying = cm.isPlaying;
      startProgressTimer();
    }
    if (!newData.stats.existCurrentMusic) dashboardData.musicInfo.currentMusic = newData.musicInfo.currentMusic;

    if (newData.musicInfo.queue && (newData.musicInfo.queue.length > 0 || type === 'music' || type === 'queue' || type === 'all')) {
      dashboardData.musicInfo.queue = newData.musicInfo.queue;
    }

    if (newData.musicInfo.trending && (newData.musicInfo.trending.length > 0 || type === 'music' || type === 'all')) {
      dashboardData.musicInfo.trending = newData.musicInfo.trending;
    }

    if (newData.musicInfo.playlists && (newData.musicInfo.playlists.length > 0 || type === 'playlist' || type === 'all')) {
      dashboardData.musicInfo.playlists = newData.musicInfo.playlists;
    }
  }

  if (newData.stats) {
    if (type === 'all' || type === 'queue' || type === 'music') dashboardData.stats.queueCount = newData.stats.queueCount;
    if (type === 'all' || type === 'music') dashboardData.stats.todayPlays = newData.stats.todayPlays;
    if (type === 'all' || type === 'playlist') dashboardData.stats.playlistCount = newData.stats.playlistCount;
  }
}

/**
 * 썸네일 또는 아이콘 요소를 생성합니다.
 */
function createThumbnail(src, fallbackSvgHtml, className = '') {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    if (className) img.className = className;
    return img;
  }
  const div = document.createElement('div');
  div.innerHTML = fallbackSvgHtml;
  return div.firstChild;
}

/**
 * 재생 큐 아이템 생성
 */
function createQueueItem(s, i) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.draggable = true;

  // 드래그 이벤트 연결
  item.addEventListener('dragstart', (e) => handleDragStart(e, 'queue', i));
  item.addEventListener('dragend', handleDragEnd);
  item.addEventListener('dragover', handleDragOver);
  item.addEventListener('dragleave', handleDragLeave);
  item.addEventListener('drop', (e) => handleDrop(e, 'queue', i));
  setupTouchEvents(item, 'queue', i);

  const num = document.createElement('div');
  num.className = 'queue-num';
  num.textContent = String(i + 1);

  const thumb = document.createElement('div');
  thumb.className = 'queue-thumb';
  thumb.appendChild(createThumbnail(s.artwork, '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'));

  const info = document.createElement('div');
  info.className = 'queue-info';
  const title = document.createElement('div');
  title.className = 'queue-title';
  title.textContent = s.title;
  const artist = document.createElement('div');
  artist.className = 'queue-artist';
  artist.textContent = s.artist;
  info.append(title, artist);

  const dur = document.createElement('div');
  dur.className = 'queue-dur';
  dur.textContent = formatTime(s.duration || 0);

  const actions = document.createElement('div');
  actions.className = 'queue-actions';
  const delBtn = document.createElement('button');
  delBtn.className = 'qa-btn';
  delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteItem('queue', i);
  };
  actions.appendChild(delBtn);

  item.append(num, thumb, info, dur, actions);
  return item;
}

/**
 * 인기 차트 아이템 생성
 */
function createTrendItem(s, i) {
  const item = document.createElement('div');
  item.className = 'trend-item';

  const rank = document.createElement('div');
  rank.className = 'trend-rank' + (i < 3 ? ' top' : '');
  rank.textContent = String(i + 1);

  const thumb = document.createElement('div');
  thumb.className = 'queue-thumb';
  thumb.style.width = '38px';
  thumb.style.height = '38px';
  thumb.style.marginRight = '8px';
  thumb.appendChild(createThumbnail(s.artwork, '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'));

  const barWrap = document.createElement('div');
  barWrap.className = 'trend-bar-wrap';
  const title = document.createElement('div');
  title.className = 'trend-title';
  title.textContent = s.title;
  const artist = document.createElement('div');
  artist.className = 'trend-artist';
  artist.textContent = s.artist;
  const bar = document.createElement('div');
  bar.className = 'trend-bar';
  const fill = document.createElement('div');
  fill.className = 'trend-bar-fill';
  fill.style.width = `${s.pct || 0}%`;
  bar.appendChild(fill);
  barWrap.append(title, artist, bar);

  const plays = document.createElement('div');
  plays.className = 'trend-plays';
  plays.textContent = `${s.count || 0}회`;

  item.append(rank, thumb, barWrap, plays);
  return item;
}

/**
 * 플레이리스트 카드 생성
 */
function createPlaylistCard(p, i) {
  const card = document.createElement('div');
  card.className = 'pl-card';
  card.draggable = true;

  // 드래그 이벤트 연결
  card.addEventListener('dragstart', (e) => handleDragStart(e, 'playlist', i));
  card.addEventListener('dragend', handleDragEnd);
  card.addEventListener('dragover', handleDragOver);
  card.addEventListener('dragenter', handleDragEnter);
  card.addEventListener('dragleave', handleDragLeave);
  card.addEventListener('drop', (e) => handleDrop(e, 'playlist', i));
  setupTouchEvents(card, 'playlist', i);

  const icon = document.createElement('div');
  icon.className = 'pl-icon';
  icon.appendChild(createThumbnail(p.artwork, '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>', 'border-radius:7px'));

  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = p.title;

  const actions = document.createElement('div');
  actions.className = 'pl-actions';

  const playBtn = document.createElement('button');
  playBtn.className = 'pl-btn';
  playBtn.textContent = '▶';
  playBtn.onclick = (e) => {
    e.stopPropagation();
    playMusic(p.uri);
  };

  const delBtn = document.createElement('button');
  delBtn.className = 'pl-btn del';
  delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteItem('playlist', i);
  };

  actions.append(playBtn, delBtn);
  card.append(icon, name, actions);
  return card;
}

async function fetchDashboardData(type = 'all') {
  if (!token) return;
  try {
    const res = await fetch(`/api/dashboard-data?token=${token}&type=${type}`);
    if (res.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /dashboard 명령어를 다시 입력해주세요.');
      return;
    }
    const response = await res.json();

    mergeDashboardData(response, type);

    if (dashboardData.server.guildId || dashboardData.server.userId) {
      initSocketConnection(dashboardData.server.guildId, dashboardData.server.userId);
    }

    else {
      isPlaying = false;
    }
    updateUI();
  }
  catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

function formatTime(ms) {
  if (!ms) return '0:00';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}:${String(rem).padStart(2, '0')}`;
}

function updateUI() {
  const { server, musicInfo: mi, stats } = dashboardData;
  const cm = mi.currentMusic;

  document.querySelector('.server-name').textContent = '현재 서버 - ' + server.name;

  // const serverLogo = document.querySelector('.server-img');
  // if (server.serverIcon) {
  //   serverLogo.replaceChildren(createThumbnail(server.serverIcon, '', 'server-icon-img'));
  //   serverLogo.querySelector('img').style.cssText = 'width:40px;height:40px;border-radius:30%;object-fit:cover;';
  // }

  const userAv = document.querySelector('.user-av');
  if (server.userIcon) {
    userAv.replaceChildren(createThumbnail(server.userIcon, '', 'user-avatar-img'));
    userAv.querySelector('img').style.cssText = 'width:40px;height:40px;border-radius:50%;object-fit:cover;';
  }
  else {
    userAv.textContent = '나';
  }

  // 2. Now Playing
  const npSection = document.querySelector('.now-playing');
  const thumbEl = document.querySelector('.thumb');

  if (cm && cm.title) {
    npSection.style.display = 'flex';
    document.querySelector('.np-title').textContent = cm.title;
    document.querySelector('.np-artist').textContent = cm.artist;
    document.querySelector('.progress-times span:first-child').textContent = formatTime(cm.position);
    document.querySelector('.progress-times span:last-child').textContent = formatTime(cm.duration);

    const progress = (cm.position / (cm.duration || 1)) * 100 || 0;
    document.querySelector('.progress-fill').style.width = `${progress}%`;
    document.querySelector('.progress-dot').style.left = `${progress}%`;

    updateProgressBarUI();

    thumbEl.replaceChildren(createThumbnail(cm.artwork, '<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px;color:var(--red);"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>', 'np-thumb-img'));

    const reqAvWrap = document.querySelector('.now-playing div:last-child div:nth-child(2) div');
    if (cm.avatar) {
      reqAvWrap.replaceChildren(createThumbnail(cm.avatar, '', 'req-avatar-img'));
      reqAvWrap.querySelector('img').style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
    }
  }
  else {
    document.querySelector('.np-title').textContent = '재생 중인 곡 없음';
    document.querySelector('.np-artist').textContent = '대기열에 곡을 추가해보세요';
    const currentRequester = document.querySelector('.now-playing div:last-child div:nth-child(2) div');
    currentRequester.textContent = '나';
    currentRequester.style = 'width:30px;height:30px;border-radius:50%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:10px;overflow:hidden;';
    if (progressInterval) clearInterval(progressInterval);
    document.querySelector('.progress-fill').style.width = '0%';
    document.querySelector('.progress-dot').style.left = '0%';
    document.querySelector('.progress-times span:first-child').textContent = '0:00';
    document.querySelector('.progress-times span:last-child').textContent = '0:00';
    thumbEl.replaceChildren(createThumbnail(null, '<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px;color:var(--muted);"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'));
  }

  // 3. Stats
  const statVals = document.querySelectorAll('.stat-val');
  if (statVals.length >= 3) {
    statVals[0].textContent = String(stats.queueCount);
    statVals[1].textContent = String(stats.todayPlays);
    statVals[2].textContent = String(stats.playlistCount);
  }

  // 4. Lists (Queue, Trending, Playlists)
  const qCountSpan = document.querySelector('.section-title span');
  if (qCountSpan) qCountSpan.textContent = `${stats.queueCount}곡`;

  // 효율적인 리스트 교체 (replaceChildren 사용)
  document.getElementById('queueList').replaceChildren(...mi.queue.map(createQueueItem));
  document.getElementById('trendList').replaceChildren(...mi.trending.map(createTrendItem));
  document.getElementById('playlistGrid').replaceChildren(...mi.playlists.map(createPlaylistCard));
}

// 초기 로드 및 주기적 갱신
if (token) {
  fetchDashboardData();
}
else {
  alert('인증 토큰이 없습니다. Discord에서 /dashboard 명령어를 입력해 주세요.');
}

window.togglePlay = function() {
  const playIcon = document.getElementById('playIcon');
  const cm = dashboardData.musicInfo.currentMusic;
  if (!cm) return;

  sendControl('pause');
  if (playIcon) {
    const isPlayingIcon = playIcon.innerHTML.includes('rect');
    playIcon.replaceChildren();
    if (isPlayingIcon) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '5 3 19 12 5 21 5 3');
      playIcon.appendChild(poly);
    }
    else {
      const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r1.setAttribute('x', '6');
      r1.setAttribute('y', '4');
      r1.setAttribute('width', '4');
      r1.setAttribute('height', '16');
      const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r2.setAttribute('x', '14');
      r2.setAttribute('y', '4');
      r2.setAttribute('width', '4');
      r2.setAttribute('height', '16');
      playIcon.append(r1, r2);
    }
  }
};
