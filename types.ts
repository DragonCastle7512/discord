import { Player, Node } from 'shoukaku';
import { Guild, VoiceBasedChannel, Interaction, Message, Collection, Client } from 'discord.js';

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
}

/**
 * 서버별 음악 재생 상태 인터페이스
 */
export interface GuildState {
  player: Player | null;
  queue: Track[];
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
 * 응답 객체 공통 인터페이스
 */
export interface RuntimeResponse {
  ok: boolean;
  message: string;
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
  history: (guildId: string, requestedBy: string) => Promise<{ total: number; items: any[] }>;
  searchTracks: (query: string) => Promise<{ tracks: Track[]; playlistName: string | null }>;
  getPlaylist: (userId: string) => Promise<any[]>;
  addToPlaylist: (guildId: string, userId: string, query: string) => Promise<RuntimeResponse>;
  clearToPlaylist: (userId: string) => Promise<RuntimeResponse>;
  getQueueSnapshot: (guildId: string) => { current: Track | null; queue: Track[] };
  moveQueueItem: (guildId: string, fromIndex: number | string, toIndex: number | string) => RuntimeResponse;
  removeQueueItem: (guildId: string, index: number | string) => RuntimeResponse;
  deleteFromPlaylist: (userId: string, index: number | string) => Promise<RuntimeResponse>;
  movePlaylistItem: (userId: string, fromIndex: number | string, toIndex: number | string) => Promise<RuntimeResponse>;
}

/**
 * TTS 실행부 인터페이스 (tts/runtime.js 기반)
 */
export interface TtsRuntime {
  playTts: (interaction: Interaction, query: string, input: string) => Promise<RuntimeResponse>;
  createPlayableUrl: (audioBuffer: Buffer) => string | null;
}

/**
 * 애플리케이션 전체 컨텍스트
 */
export interface AppContext {
  music: MusicRuntime;
  tts: TtsRuntime;
  slashCommands?: any;
}

/**
 * Discord Client 확장 타입
 */
export type MyClient = Client & {
  commands: Collection<string, any>;
};
