import { token, dashboardData, progressState } from './modules/state.js';
import { startProgressTimer, sendControl, togglePlay } from './modules/player.js';
import { updateUI } from './modules/ui.js';
import {
  switchTab,
  addBlacklistFromInput,
  filterKeywordsTable,
  searchPreviewKeywords
} from './modules/admin.js';

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
      progressState.isPlaying = false;
    }
    updateUI();
  }
  catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

if (token) {
  fetchDashboardData();
}
else {
  alert('인증 토큰이 없습니다. Discord에서 /dashboard 명령어를 입력해 주세요.');
}

// Bind to window to allow HTML onclick events to work
window.togglePlay = togglePlay;
window.switchTab = switchTab;
window.addBlacklistFromInput = addBlacklistFromInput;
window.filterKeywordsTable = filterKeywordsTable;
window.searchPreviewKeywords = searchPreviewKeywords;
window.sendControl = sendControl;
