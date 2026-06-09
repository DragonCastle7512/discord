export const urlParams = new URLSearchParams(window.location.search);
export const token = urlParams.get('token');

export const dashboardData = {
  server: { guildId: null, name: '연결 중...', channelName: '...', serverIcon: null, userIcon: null },
  musicInfo: { currentMusic: null, queue: [], trending: [], playlists: [] },
  stats: { queueCount: 0, todayPlays: 0, playlistCount: 0, existCurrentMusic: false },
};

export const progressState = {
  progressInterval: null,
  currentPos: 0,
  totalDuration: 0,
  isPlaying: false,
};
