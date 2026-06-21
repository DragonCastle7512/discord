import { token, dashboardData, progressState } from './modules/state.js';
import { startProgressTimer, sendControl, togglePlay } from './modules/player.js';
import { updateUI, initCustomAlert } from './modules/ui.js';
import {
  switchTab,
  addBlacklistFromInput,
  filterKeywordsTable,
  searchPreviewKeywords,
  setKeywordMode,
} from './modules/admin.js';
import { renderIcons } from './modules/icons.js';
import { api } from './modules/api.js';

// Initialize custom alert override
initCustomAlert();

let socket = null;

function initSocketConnection(guildId, userId) {
  if (socket || (!guildId && !userId)) return;

  socket = io({ query: { guildId, userId } });

  socket.on('musicUpdate', ({ type }) => {
    fetchDashboardData(type || 'all');
  });
}

function mergeDashboardData(newData, type) {
  if (newData.server && newData.server.guildId) {
    dashboardData.server = { ...dashboardData.server, ...newData.server };
  }

  if (newData.musicInfo) {
    if (newData.musicInfo.currentMusic !== null) {
      const cm = newData.musicInfo.currentMusic;
      dashboardData.musicInfo.currentMusic = cm;
      progressState.currentPos = cm.position;
      progressState.totalDuration = cm.duration || 0;
      progressState.isPlaying = cm.isPlaying;
      startProgressTimer();
    }
    if (!newData.stats.existCurrentMusic) {
      dashboardData.musicInfo.currentMusic = newData.musicInfo.currentMusic;
    }

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

export async function fetchDashboardData(type = 'all') {
  if (!token) return;
  try {
    const response = await api.fetchDashboardData(type);
    mergeDashboardData(response, type);

    if (dashboardData.server.guildId || dashboardData.server.userId) {
      initSocketConnection(dashboardData.server.guildId, dashboardData.server.userId);
    }
    else {
      progressState.isPlaying = false;
    }
    updateUI();
  }
  catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

function setupDOMEvents() {
  // 1. Sidebar Tabs
  const menuDashboard = document.getElementById('menu-dashboard');
  const menuAdmin = document.getElementById('menu-admin');
  if (menuDashboard) menuDashboard.addEventListener('click', () => switchTab('dashboard'));
  if (menuAdmin) menuAdmin.addEventListener('click', () => switchTab('admin'));

  // 2. Player Controls
  const addPlaylistBtn = document.getElementById('addPlaylistBtn');
  const prevBtn = document.getElementById('prevBtn');
  const playBtn = document.getElementById('playBtn');
  const skipBtn = document.getElementById('skipBtn');
  const loopBtn = document.getElementById('loopBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');

  if (addPlaylistBtn) addPlaylistBtn.addEventListener('click', () => sendControl('addPlaylist'));
  if (prevBtn) prevBtn.addEventListener('click', () => sendControl('previous'));
  if (playBtn) playBtn.addEventListener('click', () => togglePlay());
  if (skipBtn) skipBtn.addEventListener('click', () => sendControl('skip'));
  if (loopBtn) loopBtn.addEventListener('click', () => sendControl('loop'));
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => sendControl('shuffle'));

  // 3. Admin View Controls
  const btnModeServer = document.getElementById('btn-mode-server');
  const btnModePersonal = document.getElementById('btn-mode-personal');
  const blacklistAddBtn = document.getElementById('blacklistAddBtn');
  const blacklistInput = document.getElementById('blacklist-input');
  const keywordSearchInput = document.getElementById('keyword-search-input');
  const previewSearchInput = document.getElementById('preview-search-input');
  const previewSearchBtn = document.getElementById('previewSearchBtn');

  if (btnModeServer) btnModeServer.addEventListener('click', () => setKeywordMode('server'));
  if (btnModePersonal) btnModePersonal.addEventListener('click', () => setKeywordMode('personal'));
  if (blacklistAddBtn) blacklistAddBtn.addEventListener('click', () => addBlacklistFromInput());
  if (blacklistInput) {
    blacklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBlacklistFromInput();
    });
  }
  if (keywordSearchInput) {
    keywordSearchInput.addEventListener('input', () => filterKeywordsTable());
  }
  if (previewSearchInput) {
    previewSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchPreviewKeywords();
    });
  }
  if (previewSearchBtn) previewSearchBtn.addEventListener('click', () => searchPreviewKeywords());
}

if (token) {
  setupDOMEvents();
  fetchDashboardData();
  renderIcons();
}
else {
  alert('인증 토큰이 없습니다. Discord에서 /dashboard 명령어를 입력해 주세요.');
}

// Mobile menu toggle logic
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebar = document.querySelector('.sidebar');

if (menuToggleBtn && sidebarOverlay && sidebar) {
  menuToggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  });

  sidebarOverlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  });
}
