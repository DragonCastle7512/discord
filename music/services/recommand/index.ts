import { findKeywordBlacklistByUser } from '../../repositorys/user-keyword-blacklist.repository';
import { isDurationInRange } from '../../utils/track-parser';
import { logger } from '../../../common/logger';
import { Track } from '../../types';
import { selectAndCleanSongsFromSearch } from '../mood-service';
import {
  RawTrackInput,
  RecommendFromHistoryArgs,
  RecommendResult,
  RecommendedTrack,
  KeywordStat
} from './types';
import {
  clampRecommendationCount,
  getTrackInfo,
  getTrackKey,
  isKeywordMatched,
  normalizeText,
  selectRandomKeywords,
  getVideoIdFromUrl,
  interleaveByKeyword,
  TAG_KEYWORD_LIMIT,
  HISTORY_LIMIT
} from './utils';
import {
  getBlacklistForGuild,
  getPinnedKeywordsForRecommend
} from './db';

export { selectRandomKeywords };

export function buildHistoryTagKeywords(historyItems: RawTrackInput[], limit: number = TAG_KEYWORD_LIMIT): string[] {
  const artistWeight = new Map<string, number>();
  const tagWeight = new Map<string, number>();
  
  const { getTrackInfo, normalizeText, isValidTagKeyword, keywordSimilarity } = require('./utils');

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
        .map((tag: string) => normalizeText(tag))
        .filter((tag: string) => isValidTagKeyword(tag)),
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
  
  const { getTrackInfo, normalizeText, isValidTagKeyword } = require('./utils');

  const validHistoryItems = (historyItems || []).filter((entry) => {
    const base = entry?.musicInfo || entry || {};
    return !base.isSkipped;
  });

  validHistoryItems.forEach((entry) => {
    const track = getTrackInfo(entry);
    const unique = new Set<string>(
      (track.tags || [])
        .map((tag: string) => normalizeText(tag))
        .filter((tag: string) => isValidTagKeyword(tag)),
    );
    unique.forEach((tag) => weight.set(tag, (weight.get(tag) || 0) + 1));
  });

  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export async function recommendFromHistory({
  historyItems,
  count,
  searchTracks,
  region = 'KR',
  historyLimit = HISTORY_LIMIT,
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
      const userRecords = await findKeywordBlacklistByUser(userId);
      userRecords.forEach((r) => blacklistSet.add(normalizeText(r.keyword)));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load blacklist for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  const dbPins = await getPinnedKeywordsForRecommend(resolvedGuildId, userId);
  const combinedPins = Array.from(new Set([...(pinnedKeywords || []), ...dbPins]));

  const { dedupeSimilarKeywords, keywordSimilarity } = require('./utils');

  const tagFrequencies = buildHistoryTagFrequencies(recentHistoryItems);
  const tagKeywordsRaw = buildHistoryTagKeywords(recentHistoryItems, TAG_KEYWORD_LIMIT + 26);
  const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw)
    .filter((k: string) => !isKeywordMatched(k, blacklistSet))
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

  const keywordRecommendationsMap = new Map<string, RecommendedTrack[]>();
  for (const kw of keywordsToTry) {
    keywordRecommendationsMap.set(kw, []);
  }

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

  const keywordCleanPromises = searchResultsWithKeyword.map(async (result) => {
    const keyword = result.keyword;
    const tracks = result.tracks || [];

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
      const aiRequestCountForKeyword = 5;
      const cleanedTitles = await selectAndCleanSongsFromSearch(
        videoTitlesForKeyword,
        `#${keyword}`,
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

    if (cleanedTitles === null || kwRecs.length < 3) {
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

    for (const tr of kwRecs) {
      const key = getTrackKey(getTrackInfo(tr));
      if (key) {
        globalSeenKeys.add(key);
      }
    }
    keywordRecommendationsMap.set(keyword, kwRecs);
  }

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
