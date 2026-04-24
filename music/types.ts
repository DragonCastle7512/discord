import { Player, Node } from 'shoukaku';
import { Guild, VoiceBasedChannel } from 'discord.js';
import { RuntimeResponse } from '../types';

/**
 * Lavalink 트랙 정보 인터페이스
 */
export interface TrackInfo {
  title: string;
  author: string;
  uri: string;
  identifier: string;
  isSeekable: boolean;
  length: number;
  isStream: boolean;
  position: number;
  sourceName: string;
  artworkUrl?: string;
  [key: string]: any;
}

/**
 * 트랙 객체 인터페이스
 */
export interface Track {
  encoded: string;
  info: TrackInfo;
  requestedBy?: string | null;
  createAt?: Date
}

/**
 * 서버별 음악 재생 상태 인터페이스
 */
export interface GuildState {
  player: Player | null;
  queue: Track[];
  history: Track[];
  current: Track | null;
  textChannelId: string | null;
  voiceChannelId: string | null;
  playing: boolean;
  loop: boolean;
}

/**
 * 음악 유틸리티 인터페이스 (runtime-util.js 기반)
 */
export interface RuntimeUtils {
  waitForReadyNode: (timeoutMs?: number) => Promise<Node | null>;
  joinOrMovePlayer: (guild: Guild, textChannelId: string, voiceChannel: VoiceBasedChannel) => Promise<GuildState>;
  resolveTracks: (query: string) => Promise<{ tracks: Track[]; playlistName: string | null }>;
  getCurrentTrackForGuild: (guildId: string) => Promise<Track | null>;
  playNext: (guildId: string) => Promise<void>;
  stopShoukaku: (guildId: string) => Promise<void>;
}

/**
 * 플레이리스트 엔트리 인터페이스
 */
export interface PlaylistEntry {
  id: number;
  userId: string;
  musicInfo: Track;
  createdAt: Date;
}

/**
 * 히스토리 엔트리 인터페이스
 */
export interface HistoryEntry {
  id: number;
  guildId: string;
  musicInfo: Track;
  createdAt: Date;
}

/**
 * 음악 실행부 인터페이스 (runtime.js 기반)
 */
export interface MusicRuntime {
  play: (context: any, query: string) => Promise<RuntimeResponse>;
  skip: (guildId: string) => Promise<RuntimeResponse>;
  stop: (guildId: string) => Promise<RuntimeResponse>;
  queue: (guildId: string) => { message: string; count: number };
  loop: (guildId: string, enable: boolean | null) => Promise<{ enabled: boolean }>;
  history: (guildId: string, requestedBy?: string) => Promise<{ total: number; items: HistoryEntry[] }>;
  searchTracks: (query: string) => Promise<{ tracks: Track[]; playlistName: string | null }>;
  getPlaylist: (userId: string) => Promise<Track[]>;
  addToPlaylist: (guildId: string, userId: string, query: string) => Promise<RuntimeResponse>;
  clearToPlaylist: (userId: string) => Promise<RuntimeResponse>;
  getQueueSnapshot: (guildId: string) => { current: Track | null; queue: Track[] };
  moveQueueItem: (guildId: string, fromIndex: number | string, toIndex: number | string) => RuntimeResponse;
  removeQueueItem: (guildId: string, index: number | string) => RuntimeResponse;
  deleteFromPlaylist: (userId: string, index: number | string) => Promise<RuntimeResponse>;
  movePlaylistItem: (userId: string, fromIndex: number | string, toIndex: number | string) => Promise<RuntimeResponse>;
  pause: (guildId: string) => Promise<RuntimeResponse>;
  previous: (guildId: string) => Promise<RuntimeResponse>;
}
