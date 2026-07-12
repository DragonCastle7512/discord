import { KeywordBlacklist } from '../models/keyword-blacklist';
import { UserKeywordBlacklist } from '../models/user-keyword-blacklist';
import { KeywordPin } from '../models/keyword-pin';
import { UserKeywordPin } from '../models/user-keyword-pin';

import { isDurationInRange } from '../utils/track-parser';
import { logger } from '../../common/logger';
import { Track, TrackInfo } from '../types';
import { selectAndCleanSongsFromSearch } from './mood-service';

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

  const resolvedGuildId = guildId || recentHistoryItems[0]?.guildId || null;
  const blacklistSet = await getBlacklistForGuild(resolvedGuildId);

  if (userId) {
    try {
      const userRecords = await UserKeywordBlacklist.findAll({ where: { userId } });
      userRecords.forEach((r) => blacklistSet.add(normalizeText(r.keyword)));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load blacklist for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  const dbPins = await getPinnedKeywordsForRecommend(resolvedGuildId, userId);
  const combinedPins = Array.from(new Set([...(pinnedKeywords || []), ...dbPins]));


  const tagFrequencies = buildHistoryTagFrequencies(recentHistoryItems);
  const tagKeywordsRaw = buildHistoryTagKeywords(recentHistoryItems, TAG_KEYWORD_LIMIT + 26);
  const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw)
    .filter(k => !isKeywordMatched(k, blacklistSet))
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
    keywordsToTry = selectRandomKeywords(normalizedPins, remainingKeywords, 5, 5);
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

  // 각 키워드별 임시 추천곡 저장소
  const keywordRecommendationsMap = new Map<string, RecommendedTrack[]>();
  for (const kw of keywordsToTry) {
    keywordRecommendationsMap.set(kw, []);
  }

  // 중복 제거 및 노이즈 등을 통계내기 위한 맵
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

  const excludedTitles = recentHistoryItems.map(entry => {
    const info = getTrackInfo(entry);
    return `${info.author} - ${info.title}`;
  });

  // 각 키워드별로 검색된 곡 리스트를 루프 돌려 병렬로 AI 정제를 요청
  const keywordCleanPromises = searchResultsWithKeyword.map(async (result) => {
    const keyword = result.keyword;
    const tracks = result.tracks || [];

    // 해당 키워드 내부의 트랙들에 대해 후보 수집
    const videoTitlesForKeyword: string[] = [];
    const keywordTitleToTrackMap = new Map<string, Track>();

    for (const track of tracks) {
      const trackInfo = getTrackInfo(track);
      if (!isDurationInRange(trackInfo.length)) {
        continue;
      }
      const key = getTrackKey(trackInfo);
      if (!key || globalSeenKeys.has(key)) continue;
      if (excludedTrackKeys.has(key)) continue;

      const formattedTitle = `${trackInfo.author} - ${trackInfo.title}`;
      videoTitlesForKeyword.push(formattedTitle);

      const normTitle = formattedTitle.toLowerCase().replace(/\s+/g, '');
      if (!keywordTitleToTrackMap.has(normTitle)) {
        keywordTitleToTrackMap.set(normTitle, track);
      }
    }

    if (videoTitlesForKeyword.length === 0) {
      return { keyword, cleanedTitles: [], titleToTrackMap: keywordTitleToTrackMap, tracks };
    }

    try {
      // 각 키워드별로 최소 5곡씩 넉넉히 받아내도록 함
      const aiRequestCountForKeyword = 5;
      logger.info('music', `[Recommend Service] Requesting AI clean for keyword "${keyword}" with ${videoTitlesForKeyword.length} candidates`);
      const cleanedTitles = await selectAndCleanSongsFromSearch(
        videoTitlesForKeyword,
        `#${keyword}`, // 취향 태그로 이 키워드 단독 전달하여 다른 태그로 인한 임의 배제 방지!
        excludedTitles,
        aiRequestCountForKeyword
      );

      return { keyword, cleanedTitles: cleanedTitles || [], titleToTrackMap: keywordTitleToTrackMap, tracks };
    } catch (err) {
      logger.error('music', `[Recommend Service] AI filtration failed for keyword "${keyword}"`, { error: err });
      return { keyword, cleanedTitles: null, titleToTrackMap: keywordTitleToTrackMap, tracks };
    }
  });

  const cleanedResults = await Promise.all(keywordCleanPromises);

  // 각 키워드별로 추천 트랙 빌드 및 매칭
  for (const res of cleanedResults) {
    const { keyword, cleanedTitles, titleToTrackMap, tracks } = res;
    const kwRecs: RecommendedTrack[] = [];
    const kwKeySeen = new Set<string>();

    if (Array.isArray(cleanedTitles) && cleanedTitles.length > 0) {
      for (const cleanedTitle of cleanedTitles) {
        const normCleaned = cleanedTitle.toLowerCase().replace(/\s+/g, '');
        let matchedTrack = titleToTrackMap.get(normCleaned);

        if (!matchedTrack) {
          let bestScore = 0;
          for (const [normKey, track] of titleToTrackMap.entries()) {
            const sim = keywordSimilarity(normCleaned, normKey);
            if (sim > bestScore && sim >= 0.7) {
              bestScore = sim;
              matchedTrack = track;
            }
          }
        }

        if (matchedTrack) {
          const trackInfo = getTrackInfo(matchedTrack);
          const key = getTrackKey(trackInfo);

          if (key && !globalSeenKeys.has(key) && !kwKeySeen.has(key)) {
            const videoUrl = trackInfo.uri || (trackInfo.identifier ? `https://www.youtube.com/watch?v=${trackInfo.identifier}` : '');
            const videoId = trackInfo.identifier || (trackInfo.uri ? getVideoIdFromUrl(trackInfo.uri) : null);
            const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
            let artworkUrl = trackInfo.artworkUrl;
            if (!artworkUrl && fallbackThumb) {
              artworkUrl = fallbackThumb;
            }

            const fullTrack: RecommendedTrack = {
              encoded: matchedTrack.encoded,
              info: {
                ...matchedTrack.info,
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

            kwRecs.push(fullTrack);
            kwKeySeen.add(key);
          }
        }
      }
    }

    // [최소 수량 보장 Fallback] 만약 AI 클린 결과가 없거나(null) 또는 추출된 곡이 3곡 미만인 경우,
    // 해당 키워드의 원본 검색 트랙에서 수동 필터를 적용하여 최소 3곡 이상 보충합니다. (최대 5곡)
    if (cleanedTitles === null || kwRecs.length < 3) {
      logger.info('music', `[Recommend Service] Keyword "${keyword}" has insufficient AI recommended tracks (${kwRecs.length}/3). Replenishing from raw search tracks.`);
      const noiseWords = ['official', 'lyrics', 'lyric', '가사'];

      for (const track of tracks) {
        if (kwRecs.length >= 5) break;

        const trackInfo = getTrackInfo(track);
        if (!isDurationInRange(trackInfo.length)) continue;
        const key = getTrackKey(trackInfo);
        if (!key || globalSeenKeys.has(key) || kwKeySeen.has(key)) continue;
        if (excludedTrackKeys.has(key)) continue;

        const titleLower = trackInfo.title.toLowerCase();
        if (noiseWords.some(word => titleLower.includes(word))) continue;

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

        kwRecs.push(fullTrack);
        kwKeySeen.add(key);
      }
    }

    // 최종 확정된 트랙들을 글로벌 중복 방지 세트에 추가 및 글로벌 recommendations 배열에 임시 보관
    for (const tr of kwRecs) {
      const key = getTrackKey(getTrackInfo(tr));
      if (key) {
        globalSeenKeys.add(key);
      }
    }
    keywordRecommendationsMap.set(keyword, kwRecs);
  }

  // 이제 각 키워드별 큐에서 곡을 교차 배분하여 최종 recommendations 리스트를 완성한다.
  const activeQueues = keywordsToTry
    .map(kw => keywordRecommendationsMap.get(kw)!)
    .filter(Boolean);

  let hasMore = true;
  while (recommendations.length < normalizedCount && hasMore) {
    hasMore = false;
    for (const q of activeQueues) {
      if (recommendations.length >= normalizedCount) break;
      if (q.length > 0) {
        const item = q.shift()!;
        recommendations.push(item);
        
        // 통계 갱신
        const stat = keywordStatsMap.get(item.keyword || '');
        if (stat) {
          stat.collectedCount += 1;
        }
        if (!usedKeywords.includes(item.keyword || '')) {
          usedKeywords.push(item.keyword || '');
        }
        hasMore = true;
      }
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
  const displayOrder = interleaveByKeyword(finalItems, keywordsToTry);

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
  // 1. 중복 제거된 유니크 고정 핀 확보 (최대 poolSize 개)
  const pins = Array.from(new Set(pinnedKeywords)).slice(0, poolSize);

  // 2. 고정 핀 개수가 요구량을 넘는 경우
  if (pins.length >= selectSize) {
    const shuffledPins = [...pins].sort(() => Math.random() - 0.5);
    return shuffledPins.slice(0, selectSize);
  }

  // 3. 고정 핀 개수가 요구량보다 적은 경우: 고정 핀은 무조건 전체 포함
  const result = [...pins];
  const needed = selectSize - pins.length;

  // 히스토리 키워드 중 고정 핀과 겹치지 않는 키워드 필터링
  const pinnedSet = new Set(pins);
  const remainingTags = tagKeywords.filter(t => !pinnedSet.has(t));

  // 남은 자리만큼 히스토리에서 무작위 선택하여 보충
  const availablePool = remainingTags.slice(0, poolSize - pins.length);
  const shuffledTags = [...availablePool].sort(() => Math.random() - 0.5);
  const selectedTags = shuffledTags.slice(0, needed);

  return [...result, ...selectedTags];
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
  else if (guildId) {
    try {
      const guildPins = await KeywordPin.findAll({ where: { guildId } });
      dbPins.push(...guildPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  return Array.from(new Set(dbPins));
}

/**
 * 주어진 태그가 블랙리스트 또는 고정 키워드 목록의 패턴 중 하나와 유사하게 매칭되는지 확인합니다.
 */
export function isKeywordMatched(tag: string, patterns: string[] | Set<string>): boolean {
  const normTag = normalizeText(tag);
  const threshold = KEYWORD_SIMILARITY_THRESHOLD;
  return Array.from(patterns).some(pattern => {
    const normPattern = normalizeText(pattern);
    if (normTag === normPattern) return true;
    return keywordSimilarity(normTag, normPattern) >= threshold;
  });
}

/**
 * 추천 트랙 리스트를 키워드 기준으로 라운드 로빈 교차 배치합니다.
 */
export function interleaveByKeyword(tracks: RecommendedTrack[], keywords: string[]): RecommendedTrack[] {
  const keywordQueues = new Map<string, RecommendedTrack[]>();
  
  for (const kw of keywords) {
    keywordQueues.set(kw.toLowerCase(), []);
  }
  const unknownQueue: RecommendedTrack[] = [];

  for (const track of tracks) {
    const kw = String(track.keyword || '').toLowerCase();
    if (keywordQueues.has(kw)) {
      keywordQueues.get(kw)!.push(track);
    } else {
      unknownQueue.push(track);
    }
  }

  const ordered: RecommendedTrack[] = [];
  const activeQueues = keywords
    .map(kw => keywordQueues.get(kw.toLowerCase())!)
    .filter(Boolean);

  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const q of activeQueues) {
      if (q.length > 0) {
        ordered.push(q.shift()!);
        hasMore = true;
      }
    }
  }

  if (unknownQueue.length > 0) {
    ordered.push(...unknownQueue);
  }

  return ordered;
}
