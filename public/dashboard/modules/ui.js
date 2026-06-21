import { dashboardData, progressState } from './state.js';
import { formatTime, updateProgressBarUI } from './player.js';
import { handleDragStart, handleDragEnd, handleDragOver, handleDragLeave, handleDrop, setupTouchEvents, deleteItem } from './dragdrop.js';
import { playMusic } from './player.js';
import { getIcon } from './icons.js';

export function createThumbnail(src, fallbackSvgHtml, className = '') {
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

export function createQueueItem(s, i) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.draggable = true;

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
  thumb.appendChild(createThumbnail(s.artwork, getIcon('music')));

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
  delBtn.innerHTML = getIcon('trash');
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteItem('queue', i);
  };
  actions.appendChild(delBtn);

  item.append(num, thumb, info, dur, actions);
  return item;
}

export function createTrendItem(s, i) {
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
  thumb.appendChild(createThumbnail(s.artwork, getIcon('music')));

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

export function createPlaylistCard(p, i) {
  const card = document.createElement('div');
  card.className = 'pl-card';
  card.draggable = true;

  card.addEventListener('dragstart', (e) => handleDragStart(e, 'playlist', i));
  card.addEventListener('dragend', handleDragEnd);
  card.addEventListener('dragover', handleDragOver);
  card.addEventListener('dragenter', handleDragLeave);
  card.addEventListener('dragleave', handleDragLeave);
  card.addEventListener('drop', (e) => handleDrop(e, 'playlist', i));
  setupTouchEvents(card, 'playlist', i);

  const icon = document.createElement('div');
  icon.className = 'pl-icon';
  icon.appendChild(createThumbnail(p.artwork, getIcon('music'), 'border-radius:7px'));

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
  delBtn.innerHTML = getIcon('trash');
  delBtn.onclick = (e) => {
    e.stopPropagation();
    deleteItem('playlist', i);
  };

  actions.append(playBtn, delBtn);
  card.append(icon, name, actions);
  return card;
}

export function updateUI() {
  const { server, musicInfo: mi, stats } = dashboardData;
  const cm = mi.currentMusic;

  document.querySelector('.server-name').textContent = '현재 서버 - ' + server.name;

  const userAv = document.querySelector('.user-av');
  if (server.userIcon) {
    userAv.replaceChildren(createThumbnail(server.userIcon, '', 'user-avatar-img'));
    userAv.querySelector('img').style.cssText = 'width:40px;height:40px;border-radius:50%;object-fit:cover;';
  }
  else {
    userAv.textContent = '나';
  }

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

    thumbEl.replaceChildren(createThumbnail(cm.artwork, getIcon('musicRed'), 'np-thumb-img'));

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
    if (progressState.progressInterval) clearInterval(progressState.progressInterval);
    document.querySelector('.progress-fill').style.width = '0%';
    document.querySelector('.progress-dot').style.left = '0%';
    document.querySelector('.progress-times span:first-child').textContent = '0:00';
    document.querySelector('.progress-times span:last-child').textContent = '0:00';
    thumbEl.replaceChildren(createThumbnail(null, getIcon('musicMuted')));
  }

  const statVals = document.querySelectorAll('.stat-val');
  if (statVals.length >= 3) {
    statVals[0].textContent = String(stats.queueCount);
    statVals[1].textContent = String(stats.todayPlays);
    statVals[2].textContent = String(stats.playlistCount);
  }

  const qCountSpan = document.querySelector('.section-title span');
  if (qCountSpan) qCountSpan.textContent = `${stats.queueCount}곡`;

  document.getElementById('queueList').replaceChildren(...mi.queue.map(createQueueItem));
  document.getElementById('trendList').replaceChildren(...mi.trending.map(createTrendItem));
  document.getElementById('playlistGrid').replaceChildren(...mi.playlists.map(createPlaylistCard));
}

// Toast Notification System
export function showToast(message) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  container.appendChild(toast);

  // Force reflow for transition
  toast.offsetHeight;
  toast.classList.add('show');

  // Fade out and remove
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      if (container.childNodes.length === 0) {
        container.remove();
      }
    });
  }, 3000);
}

// Custom Alert Dialog System
export function initCustomAlert() {
  window.alert = function (message) {
    // Prevent duplicated modals
    if (document.querySelector('.custom-modal-overlay')) return;

    // Body scroll lock
    document.body.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';

    const card = document.createElement('div');
    card.className = 'custom-modal-card';

    const header = document.createElement('div');
    header.className = 'custom-modal-header';
    header.innerHTML = `
      ${getIcon('alert')}
      <span>알림</span>
    `;

    const body = document.createElement('div');
    body.className = 'custom-modal-body';
    body.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'custom-modal-footer';

    const btn = document.createElement('button');
    btn.className = 'custom-modal-btn';
    btn.textContent = '확인';

    const closeModal = () => {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', () => {
        overlay.remove();
        document.body.style.overflow = '';
      });
    };

    btn.onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

    footer.appendChild(btn);
    card.append(header, body, footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Force reflow
    overlay.offsetHeight;
    overlay.classList.add('show');
  };
}

// Custom Confirm Dialog System
export function showCustomConfirm(message) {
  return new Promise((resolve) => {
    // Prevent duplicated modals
    if (document.querySelector('.custom-modal-overlay')) {
      resolve(false);
      return;
    }

    // Body scroll lock
    document.body.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';

    const card = document.createElement('div');
    card.className = 'custom-modal-card';

    const header = document.createElement('div');
    header.className = 'custom-modal-header';
    header.innerHTML = `
      ${getIcon('confirm')}
      <span>확인 필요</span>
    `;

    const body = document.createElement('div');
    body.className = 'custom-modal-body';
    body.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'custom-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'custom-modal-btn cancel';
    cancelBtn.textContent = '취소';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'custom-modal-btn';
    confirmBtn.textContent = '확인';

    const closeWithResult = (result) => {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', () => {
        overlay.remove();
        document.body.style.overflow = '';
        resolve(result);
      });
    };

    confirmBtn.onclick = () => closeWithResult(true);
    cancelBtn.onclick = () => closeWithResult(false);
    
    overlay.onclick = (e) => {
      if (e.target === overlay) closeWithResult(false);
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeWithResult(false);
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

    footer.append(cancelBtn, confirmBtn);
    card.append(header, body, footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Force reflow
    overlay.offsetHeight;
    overlay.classList.add('show');
  });
}
