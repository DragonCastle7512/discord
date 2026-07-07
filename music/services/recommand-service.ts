import { KeywordBlacklist } from '../models/keyword-blacklist';
import { UserKeywordBlacklist } from '../models/user-keyword-blacklist';
import { KeywordPin } from '../models/keyword-pin';
import { UserKeywordPin } from '../models/user-keyword-pin';

import { isDurationInRange } from '../utils/track-parser';
import { logger } from '../../common/logger';
import { Track, TrackInfo } from '../types';

/**
 * 추천 트랙 확장 인터페이스
 */
export interface RecommendedTrack extends Track {
  source?: string;
  keyword?: string;
}

/**
 * 납작하게 정제된 트랙 정보 인터페이스
 */
export interface FlattenedTrackInfo {
  title: string;
  author: string;
  uri: string;
  artworkUrl: string | null;
  length: number;
  tags: string[];
  identifier: string;
}

/**
 * 원시 트랙 입력 인터페이스 (HistoryEntry, PlaylistEntry 등 다중 구조 호환)
 */
export interface RawTrackInput {
  musicInfo?: Track;
  info?: Partial<TrackInfo>;
  tags?: string[];
  isSkipped?: boolean;
  guildId?: string;
}

/**
 * 인기 아이템 데이터 구조
 */
export interface PopularItem {
  id?: string;
  url?: string;
}

/**
 * 추천 통계 인터페이스
 */
export interface KeywordStat {
  keyword: string;
  rawCount: number;
  collectedCount: number;
  limitApplied?: number | null;
}

/**
 * 추천 실행 인수 인터페이스
 */
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

/**
 * 추천 실행 결과 반환 인터페이스
 */
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

const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;
const HISTORY_LIMIT = 100;
const POPULAR_LIMIT = 50;
const TAG_KEYWORD_LIMIT = 4;
const KEYWORD_SIMILARITY_THRESHOLD = 0.6;
const MIN_TAG_KEYWORD_LENGTH = 4;

export async function getBlacklistForGuild(guildId: string | null | undefined): Promise<Set<string>> {
  if (!guildId) return new Set<string>();
  try {
    const records = await KeywordBlacklist.findAll({ where: { guildId } });
    return new Set<string>(records.map(r => normalizeText(r.keyword)));
  } catch (err) {
    logger.error('system', `[Recommend Service] Failed to load blacklist for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    return new Set<string>();
  }
}

export function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? (intersection / union) : 0;
}

export function containmentSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;

  let inter = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) inter += 1;
  }
  return Math.max(inter / tokensA.size, inter / tokensB.size);
}

export function keywordSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), containmentSimilarity(a, b));
}

export function isValidTagKeyword(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  const noise = ['official', 'lyrics', 'lyric', '가사', 'music', 'mv', 'audio', 'video'];
  if (noise.some((word) => normalized.includes(word))) return false;

  return normalized.replace(/\s+/g, '').length >= MIN_TAG_KEYWORD_LENGTH;
}

export function dedupeSimilarKeywords(keywords: string[] | null | undefined, threshold: number = KEYWORD_SIMILARITY_THRESHOLD): string[] {
  const selected: string[] = [];
  for (const keyword of keywords || []) {
    const normalized = normalizeText(keyword);
    if (!isValidTagKeyword(normalized)) continue;
    const duplicated = selected.some((picked) => keywordSimilarity(picked, normalized) >= threshold);
    if (!duplicated) {
      selected.push(normalized);
    }
  }
  return selected;
}

export function getTrackInfo(raw: RawTrackInput | null | undefined): FlattenedTrackInfo {
  if (!raw) {
    return { title: 'Unknown title', author: '', uri: '', artworkUrl: null, length: 0, tags: [], identifier: '' };
  }
  const base = (raw.musicInfo || raw) as Record<string, any>;
  const info = (base?.info || {}) as Record<string, any>;
  return {
    title: String(info.title || 'Unknown title'),
    author: String(info.author || ''),
    uri: String(info.uri || ''),
    artworkUrl: info.artworkUrl ? String(info.artworkUrl) : null,
    length: Number(info.length) || 0,
    tags: Array.isArray(base?.tags) ? (base.tags as string[]) : [],
    identifier: String(info.identifier || ''),
  };
}

export function getTrackKey(track: { uri?: string; author?: string; title?: string }): string {
  const uri = normalizeText(track.uri);
  if (uri) return `uri:${uri}`;
  return `meta:${normalizeText(track.author)}|${normalizeText(track.title)}`;
}

export function clampRecommendationCount(input: unknown): number {
  const parsed = Number.parseInt(String(input || DEFAULT_COUNT), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_COUNT;
  return Math.min(parsed, MAX_COUNT);
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '?:??';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function isPrimarySource(source: string | null | undefined): boolean {
  return String(source || '').startsWith('history-tag-1');
}

export function interleaveBySource(tracks: RecommendedTrack[], count: number): RecommendedTrack[] {
  const firstList = tracks.filter((track) => isPrimarySource(track.source));
  const secondList = tracks.filter((track) => !isPrimarySource(track.source));
  const ordered: RecommendedTrack[] = [];
  let useFirst = true;

  while (ordered.length < count && (firstList.length > 0 || secondList.length > 0)) {
    if (useFirst && firstList.length > 0) {
      const item = firstList.shift();
      if (item) ordered.push(item);
    }
    else if (!useFirst && secondList.length > 0) {
      const item = secondList.shift();
      if (item) ordered.push(item);
    }
    else if (firstList.length > 0) {
      const item = firstList.shift();
      if (item) ordered.push(item);
    }
    else if (secondList.length > 0) {
      const item = secondList.shift();
      if (item) ordered.push(item);
    }
    useFirst = !useFirst;
  }

  return ordered.slice(0, count);
}

export function getVideoIdFromUrl(url: string | null | undefined): string | null {
  try {
    const value = String(url || '').trim();
    if (!value) return null;
    const u = new URL(value);
    if (u.hostname.toLowerCase() === 'youtu.be') return u.pathname.replace('/', '') || null;
    if (u.hostname.toLowerCase().includes('youtube.com')) return u.searchParams.get('v');
    return null;
  }
  catch {
    return null;
  }
}

export function buildHistoryTagKeywords(historyItems: RawTrackInput[], limit: number = TAG_KEYWORD_LIMIT): string[] {
  const artistWeight = new Map<string, number>();
  const tagWeight = new Map<string, number>();

  const validHistoryItems = (historyItems || []).filter((entry) => {
    const base = entry?.musicInfo || entry || {};
    return !base.isSkipped;
  });

  validHistoryItems.forEach((entry) => {
    const track = getTrackInfo(entry);

    const author = normalizeText(track.author);
    if (author) {
      artistWeight.set(author, (artistWeight.get(author) || 0) + 1);
    }

    const unique = new Set<string>(
      (track.tags || [])
        .map((tag) => normalizeText(tag))
        .filter((tag) => isValidTagKeyword(tag)),
    );
    unique.forEach((tag) => tagWeight.set(tag, (tagWeight.get(tag) || 0) + 1));
  });

  const topArtists = [...artistWeight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);

  const keywordScores = [...tagWeight.entries()].map(([tag, freq]) => {
    let bestArtistSimilarity = 0;
    let matchedArtistWeight = 0;
    for (const [artist, artistFreq] of topArtists) {
      const sim = keywordSimilarity(tag, artist);
      if (sim > bestArtistSimilarity) {
        bestArtistSimilarity = sim;
        matchedArtistWeight = artistFreq;
      }
    }

    const artistBonus = bestArtistSimilarity * Math.log1p(matchedArtistWeight);
    const score = freq + artistBonus;
    return {
      tag,
      score,
      freq,
      bestArtistSimilarity,
    };
  });

  return keywordScores
    .sort((a, b) => (
      b.score - a.score
      || b.freq - a.freq
      || b.bestArtistSimilarity - a.bestArtistSimilarity
      || a.tag.localeCompare(b.tag)
    ))
    .slice(0, limit)
    .map((item) => item.tag);
}

export function buildHistoryTagFrequencies(historyItems: RawTrackInput[]): [string, number][] {
  const weight = new Map<string, number>();

  const validHistoryItems = (historyItems || []).filter((entry) => {
    const base = entry?.musicInfo || entry || {};
    return !base.isSkipped;
  });

  validHistoryItems.forEach((entry) => {
    const track = getTrackInfo(entry);
    const unique = new Set<string>(
      (track.tags || [])
        .map((tag) => normalizeText(tag))
        .filter((tag) => isValidTagKeyword(tag)),
    );
    unique.forEach((tag) => weight.set(tag, (weight.get(tag) || 0) + 1));
  });

  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function parseUserIdFromArg(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return String((value as { id: unknown }).id);
  }

  const text = String(value).trim();
  if (!text) return null;
  const mention = /^<@!?(\d+)>$/.exec(text);
  if (mention) return mention[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}

interface CollectFromPopularItemsArgs {
  popularItems: PopularItem[];
  searchTracks: (query: string) => Promise<{ tracks: Track[] | null; playlistName?: string | null }>;
  excludedTrackKeys: Set<string>;
  globalSeenKeys: Set<string>;
  maxCount: number;
  source: string;
  keyword: string;
}

async function collectFromPopularItems({
  popularItems,
  searchTracks,
  excludedTrackKeys,
  globalSeenKeys,
  maxCount,
  source,
  keyword,
}: CollectFromPopularItemsArgs): Promise<RecommendedTrack[]> {
  const collected: RecommendedTrack[] = [];
  const items = popularItems || [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (item) => {
        const videoUrl = item?.url || (item?.id ? `https://www.youtube.com/watch?v=${item.id}` : '');
        if (!videoUrl) return null;
        try {
          const resolved = await searchTracks(videoUrl);
          return { resolved, videoUrl };
        }
        catch {
          return null;
        }
      }),
    );

    for (const result of results) {
      if (!result) continue;
      const { resolved, videoUrl } = result;
      const first = Array.isArray(resolved?.tracks) ? resolved.tracks[0] : null;
      if (!first) continue;

      const trackInfo = getTrackInfo(first);
      const titleLower = trackInfo.title.toLowerCase();
      const noiseWords = ['official', 'lyrics', 'lyric', '가사'];
      if (noiseWords.some(word => titleLower.includes(word))) {
          continue;
      }

      const key = getTrackKey(trackInfo);
      if (!key || globalSeenKeys.has(key)) continue;
      if (excludedTrackKeys.has(key)) continue;
      if (!isDurationInRange(trackInfo.length)) continue;

      const videoId = getVideoIdFromUrl(videoUrl);
      const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
      let artworkUrl = trackInfo.artworkUrl;
      if (!artworkUrl && fallbackThumb) {
        artworkUrl = fallbackThumb;
      }

      const fullTrack: RecommendedTrack = {
        encoded: first.encoded,
        info: {
          ...first.info,
          title: trackInfo.title,
          author: trackInfo.author,
          uri: trackInfo.uri,
          artworkUrl: artworkUrl || undefined,
          length: trackInfo.length,
        },
        tags: trackInfo.tags,
        source: source,
        keyword: keyword,
      };

      globalSeenKeys.add(key);
      collected.push(fullTrack);
      if (collected.length >= maxCount) return collected;
    }
  }
  return collected;
}

export async function recommendFromHistory({
  historyItems,
  count,
  fetchPopularByKeyword,
  searchTracks,
  region = 'KR',
  historyLimit = HISTORY_LIMIT,
  popularLimit = POPULAR_LIMIT,
  randomizeKeywordsCount = null,
  guildId = null,
  userId = null,
  pinnedKeywords = [],
}: RecommendFromHistoryArgs): Promise<RecommendResult> {
  const normalizedCount = clampRecommendationCount(count);
  const recentHistoryItems = (Array.isArray(historyItems) ? historyItems : []).slice(0, historyLimit);

  if (!recentHistoryItems.length) {
    return {
      ok: false,
      reason: '최근에 재생한 곡이 없어요. 재생 이후에 다시 시도해주세요!',
      count: 0,
      historyUsed: 0,
      items: [],
      keywords: [],
      tagFrequencies: [],
    };
  }

  const resolvedGuildId = guildId || recentHistoryItems[0]?.guildId;
  const blacklistSet = await getBlacklistForGuild(resolvedGuildId);

  if (userId) {
    try {
      const userRecords = await UserKeywordBlacklist.findAll({ where: { userId } });
      userRecords.forEach((r) => blacklistSet.add(normalizeText(r.keyword)));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load blacklist for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  const dbPins: string[] = [];
  if (userId) {
    try {
      const userPins = await UserKeywordPin.findAll({ where: { userId } });
      dbPins.push(...userPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }
  if (resolvedGuildId) {
    try {
      const guildPins = await KeywordPin.findAll({ where: { guildId: resolvedGuildId } });
      dbPins.push(...guildPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for guild ${resolvedGuildId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }
  const combinedPins = Array.from(new Set([...(pinnedKeywords || []), ...dbPins]));


  const tagFrequencies = buildHistoryTagFrequencies(recentHistoryItems);
  const tagKeywordsRaw = buildHistoryTagKeywords(recentHistoryItems, TAG_KEYWORD_LIMIT + 26);
  const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw)
    .filter(k => !blacklistSet.has(k))
    .slice(0, TAG_KEYWORD_LIMIT + 6);

  const excludedTrackKeys = new Set<string>();
  recentHistoryItems.forEach((entry) => {
    const key = getTrackKey(getTrackInfo(entry));
    if (key) excludedTrackKeys.add(key);
  });

  const globalSeenKeys = new Set<string>();
  const recommendations: RecommendedTrack[] = [];
  const usedKeywords: string[] = [];

  const normalizedPins = combinedPins
    .map(k => normalizeText(k))
    .filter(k => !blacklistSet.has(k))
    .slice(0, 5);

  const pinnedSet = new Set(normalizedPins);
  const remainingKeywords = tagKeywords.filter(k => !pinnedSet.has(k));

  let keywordsToTry: string[] = [];
  if (userId) {
    keywordsToTry = selectRandomKeywords(normalizedPins, remainingKeywords, 5, 3);
  }
  else if (randomizeKeywordsCount && (tagKeywords.length > 0 || normalizedPins.length > 0)) {
    const shuffledRemaining = [...remainingKeywords].sort(() => Math.random() - 0.5);
    keywordsToTry = [...normalizedPins, ...shuffledRemaining].slice(0, randomizeKeywordsCount);
  }
  else {
    keywordsToTry = [...normalizedPins, ...remainingKeywords].slice(0, 5);
  }

  if (keywordsToTry.length === 0) {
    keywordsToTry = ['music'];
  }
  const firstHalfTarget = Math.ceil(normalizedCount / 2);

  // 각 키워드별 검색 결과를 비동기적으로 조회 (Lavalink 직접 검색)
  const searchPromises = keywordsToTry.map(async (keyword) => {
    try {
      const res = await searchTracks(keyword);
      const rawTracks = res?.tracks || [];
      return { keyword, tracks: rawTracks };
    } catch (err) {
      logger.error('music', `[Recommend Service] Search failed for keyword "${keyword}"`, { error: err });
      return { keyword, tracks: [] as Track[] };
    }
  });

  const searchResultsWithKeyword = await Promise.all(searchPromises);

  // 대시보드 스타일로 Interleave (교차 배치)
  const maxTracks = Math.max(...searchResultsWithKeyword.map(r => r.tracks.length), 0);
  const mixedTracksWithKeyword: { track: Track; keyword: string }[] = [];

  for (let i = 0; i < maxTracks; i++) {
    for (const result of searchResultsWithKeyword) {
      if (result.tracks[i]) {
        mixedTracksWithKeyword.push({ track: result.tracks[i], keyword: result.keyword });
      }
    }
  }

  // 중복 제거, 노이즈 및 재생 시간 필터링 적용
  const keywordStatsMap = new Map<string, { rawCount: number; collectedCount: number }>();
  
  for (const kw of keywordsToTry) {
    keywordStatsMap.set(kw, { rawCount: 0, collectedCount: 0 });
  }
  
  for (const result of searchResultsWithKeyword) {
    const stat = keywordStatsMap.get(result.keyword);
    if (stat) {
      stat.rawCount = result.tracks.length;
    }
  }

  const noiseWords = ['official', 'lyrics', 'lyric', '가사'];

  for (const { track, keyword } of mixedTracksWithKeyword) {
    if (recommendations.length >= normalizedCount) break;

    const trackInfo = getTrackInfo(track);
    const titleLower = trackInfo.title.toLowerCase();
    
    // 노이즈 필터링
    if (noiseWords.some(word => titleLower.includes(word))) {
      continue;
    }

    // 재생 시간 필터링 (1m 30s ~ 6m)
    if (!isDurationInRange(trackInfo.length)) {
      continue;
    }

    // 중복 필터링
    const key = getTrackKey(trackInfo);
    if (!key || globalSeenKeys.has(key)) continue;
    if (excludedTrackKeys.has(key)) continue;

    const videoUrl = trackInfo.uri || (trackInfo.identifier ? `https://www.youtube.com/watch?v=${trackInfo.identifier}` : '');
    const videoId = trackInfo.identifier || (trackInfo.uri ? getVideoIdFromUrl(trackInfo.uri) : null);
    const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
    let artworkUrl = trackInfo.artworkUrl;
    if (!artworkUrl && fallbackThumb) {
      artworkUrl = fallbackThumb;
    }

    const fullTrack: RecommendedTrack = {
      encoded: track.encoded,
      info: {
        ...track.info,
        title: trackInfo.title,
        author: trackInfo.author,
        uri: trackInfo.uri,
        artworkUrl: artworkUrl || undefined,
        length: trackInfo.length,
      },
      tags: trackInfo.tags,
      source: `history-tag-search`,
      keyword: keyword,
    };

    globalSeenKeys.add(key);
    recommendations.push(fullTrack);

    const stat = keywordStatsMap.get(keyword);
    if (stat) {
      stat.collectedCount += 1;
    }
    
    if (!usedKeywords.includes(keyword)) {
      usedKeywords.push(keyword);
    }
  }

  const keywordStats: KeywordStat[] = keywordsToTry.map(kw => {
    const stat = keywordStatsMap.get(kw) || { rawCount: 0, collectedCount: 0 };
    return {
      keyword: kw,
      rawCount: stat.rawCount,
      collectedCount: stat.collectedCount,
    };
  });

  if (!recommendations.length) {
    logger.warn('music', `Failed to generate recommendations for guild ${resolvedGuildId}`, {
      guildId: resolvedGuildId,
      userId,
      reason: 'No suitable recommendation results found',
      keywordsTried: keywordsToTry,
      keywordStats,
    });
    return {
      ok: false,
      reason: '적절한 추천 결과가 없어요!',
      count: 0,
      historyUsed: recentHistoryItems.length,
      items: [],
      keywords: keywordsToTry,
      keywordStats,
      tagFrequencies,
    };
  }

  const finalItems = recommendations.slice(0, normalizedCount);
  const displayOrder = interleaveBySource(finalItems, finalItems.length);

  logger.info('music', `Generated recommendations for guild ${resolvedGuildId}`, {
    guildId: resolvedGuildId,
    userId,
    requestedCount: count,
    recommendedCount: displayOrder.length,
    usedKeywords,
    keywordStats,
  });

  return {
    ok: true,
    reason: null,
    count: displayOrder.length,
    historyUsed: recentHistoryItems.length,
    items: displayOrder,
    keywords: usedKeywords,
    keywordStats,
    tagFrequencies,
  };
}

/**
 * 키워드 풀에서 무작위로 지정된 개수만큼 선택하여 최종 키워드 리스트를 반환합니다. (1위 고정 없음)
 */
export function selectRandomKeywords(
  pinnedKeywords: string[],
  tagKeywords: string[],
  poolSize = 5,
  selectSize = 3
): string[] {
  const combined = Array.from(new Set([...pinnedKeywords, ...tagKeywords]));
  const pool = combined.slice(0, poolSize);

  if (pool.length <= selectSize) {
    return pool;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, selectSize);
}

/**
 * 지정된 guildId 및 userId에 매핑된 모든 고정 키워드를 비동기적으로 조회하여 반환합니다.
 */
export async function getPinnedKeywordsForRecommend(
  guildId: string | null,
  userId?: string | null
): Promise<string[]> {
  const dbPins: string[] = [];

  if (userId) {
    try {
      const userPins = await UserKeywordPin.findAll({ where: { userId } });
      dbPins.push(...userPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  if (guildId) {
    try {
      const guildPins = await KeywordPin.findAll({ where: { guildId } });
      dbPins.push(...guildPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  return Array.from(new Set(dbPins));
}
