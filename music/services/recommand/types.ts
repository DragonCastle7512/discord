import { Track, TrackInfo } from '../../types';

export interface RecommendedTrack extends Track {
  source?: string;
  keyword?: string;
}

export interface FlattenedTrackInfo {
  title: string;
  author: string;
  uri: string;
  artworkUrl: string | null;
  length: number;
  tags: string[];
  identifier: string;
}

export interface RawTrackInput {
  musicInfo?: Track;
  info?: Partial<TrackInfo>;
  tags?: string[];
  isSkipped?: boolean;
  guildId?: string;
}

export interface PopularItem {
  id?: string;
  url?: string;
}

export interface KeywordStat {
  keyword: string;
  rawCount: number;
  collectedCount: number;
  limitApplied?: number | null;
}

export interface RecommendFromHistoryArgs {
  historyItems: RawTrackInput[];
  count: number | string;
  fetchPopularByKeyword?: (args: { keyword: string; limit: number; region: string }) => Promise<PopularItem[]>;
  searchTracks: (query: string) => Promise<{ tracks: Track[] | null; playlistName?: string | null }>;
  region?: string;
  historyLimit?: number;
  popularLimit?: number;
  randomizeKeywordsCount?: number | null;
  guildId?: string | null;
  userId?: string | null;
  pinnedKeywords?: string[];
}

export interface RecommendResult {
  ok: boolean;
  reason: string | null;
  count: number;
  historyUsed: number;
  items: RecommendedTrack[];
  keywords: string[];
  keywordStats?: KeywordStat[];
  tagFrequencies?: [string, number][];
}
