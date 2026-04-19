/**
 * 개별 음악 아이템 정보 (리스트 및 현재 곡 공통)
 */
export interface MusicItem {
  title: string;
  artist: string;
  artwork: string | null;
  duration?: number;
  requestedBy?: string | null;
  count?: number;
  pct?: number;
  uri?: string;
  encoded?: string;
}

/**
 * 현재 재생 중인 곡 정보 (MusicItem 확장)
 */
export interface CurrentMusic extends MusicItem {
  position: number;
  isPlaying: boolean;
  avatar: string | null; // 요청자 아바타
}

/**
 * 통합 대시보드 응답 인터페이스
 */
export interface DashboardResponse {
  server: {
    name: string;
    // serverIcon: string | null;
    userIcon: string | null;
    channelName: string;
  };
  musicInfo: {
    currentMusic: CurrentMusic | null;
    queue: MusicItem[];
    trending: MusicItem[];
    playlists: MusicItem[];
  };
  stats: {
    queueCount: number;
    todayPlays: number;
    playlistCount: number;
  };
}

/**
 * 상태 체크 응답 인터페이스
 */
export interface HealthResponse {
  ok: boolean;
  timestamp: number;
}
