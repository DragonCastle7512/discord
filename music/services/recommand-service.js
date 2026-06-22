const { KeywordBlacklist } = require('../models/keyword-blacklist');
const { isDurationInRange } = require('../utils/track-parser');
const { logger } = require('../../common/logger');

async function getBlacklistForGuild(guildId) {
  if (!guildId) return new Set();
  try {
    const records = await KeywordBlacklist.findAll({ where: { guildId } });
    return new Set(records.map(r => normalizeText(r.keyword)));
  } catch (err) {
    logger.error('system', `[Recommend Service] Failed to load blacklist for guild ${guildId}`, { error: err.stack });
    return new Set();
  }
}

const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;
const HISTORY_LIMIT = 100;
const POPULAR_LIMIT = 50;
const TAG_KEYWORD_LIMIT = 4;
const KEYWORD_SIMILARITY_THRESHOLD = 0.6;
const MIN_TAG_KEYWORD_LENGTH = 4;


function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

function jaccardSimilarity(a, b) {
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

function containmentSimilarity(a, b) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;

  let inter = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) inter += 1;
  }
  return Math.max(inter / tokensA.size, inter / tokensB.size);
}

function keywordSimilarity(a, b) {
  return Math.max(jaccardSimilarity(a, b), containmentSimilarity(a, b));
}

function isValidTagKeyword(value) {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  const noise = ['official', 'lyrics', 'lyric', '가사', 'music', 'mv', 'audio', 'video'];
  if (noise.some((word) => normalized.includes(word))) return false;

  return normalized.replace(/\s+/g, '').length >= MIN_TAG_KEYWORD_LENGTH;
}

function dedupeSimilarKeywords(keywords, threshold = KEYWORD_SIMILARITY_THRESHOLD) {
  const selected = [];
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

function getTrackInfo(raw) {
  const base = raw?.musicInfo || raw || {};
  const info = base?.info || {};
  return {
    title: info.title || 'Unknown title',
    author: info.author || '',
    uri: info.uri || '',
    artworkUrl: info.artworkUrl || null,
    length: Number(info.length) || 0,
    tags: Array.isArray(base?.tags) ? base.tags : [],
  };
}

function getTrackKey(track) {
  const uri = normalizeText(track.uri);
  if (uri) return `uri:${uri}`;
  return `meta:${normalizeText(track.author)}|${normalizeText(track.title)}`;
}

function clampRecommendationCount(input) {
  const parsed = Number.parseInt(String(input || DEFAULT_COUNT), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_COUNT;
  return Math.min(parsed, MAX_COUNT);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '?:??';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isPrimarySource(source) {
  return String(source || '').startsWith('history-tag-1');
}

function interleaveBySource(tracks, count) {
  const firstList = tracks.filter((track) => isPrimarySource(track.source));
  const secondList = tracks.filter((track) => !isPrimarySource(track.source));
  const ordered = [];
  let useFirst = true;

  while (ordered.length < count && (firstList.length > 0 || secondList.length > 0)) {
    if (useFirst && firstList.length > 0) {
      ordered.push(firstList.shift());
    }
    else if (!useFirst && secondList.length > 0) {
      ordered.push(secondList.shift());
    }
    else if (firstList.length > 0) {
      ordered.push(firstList.shift());
    }
    else if (secondList.length > 0) {
      ordered.push(secondList.shift());
    }
    useFirst = !useFirst;
  }

  return ordered.slice(0, count);
}

function getVideoIdFromUrl(url) {
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

function buildHistoryTagKeywords(historyItems, limit = TAG_KEYWORD_LIMIT) {
  const artistWeight = new Map();
  const tagWeight = new Map();

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

    const unique = new Set(
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

function buildHistoryTagFrequencies(historyItems) {
  const weight = new Map();

  const validHistoryItems = (historyItems || []).filter((entry) => {
    const base = entry?.musicInfo || entry || {};
    return !base.isSkipped;
  });

  validHistoryItems.forEach((entry) => {
    const track = getTrackInfo(entry);
    const unique = new Set(
      (track.tags || [])
        .map((tag) => normalizeText(tag))
        .filter((tag) => isValidTagKeyword(tag)),
    );
    unique.forEach((tag) => weight.set(tag, (weight.get(tag) || 0) + 1));
  });

  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function parseUserIdFromArg(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value.id) return String(value.id);

  const text = String(value).trim();
  if (!text) return null;
  const mention = /^<@!?(\d+)>$/.exec(text);
  if (mention) return mention[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}

async function collectFromPopularItems({
  popularItems,
  searchTracks,
  excludedTrackKeys,
  globalSeenKeys,
  maxCount,
  source,
  keyword,
}) {
  const collected = [];
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

      const track = getTrackInfo(first);
      const titleLower = String(track.title || '').toLowerCase();
      const noiseWords = ['official', 'lyrics', 'lyric', '가사'];
      if (noiseWords.some(word => titleLower.includes(word))) {
          continue;
      }

      const key = getTrackKey(track);
      if (!key || globalSeenKeys.has(key)) continue;
      if (excludedTrackKeys.has(key)) continue;
      if (!isDurationInRange(track.length)) continue;

      const videoId = getVideoIdFromUrl(videoUrl);
      const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
      if (!track.artworkUrl && fallbackThumb) {
        track.artworkUrl = fallbackThumb;
      }

      track.source = source;
      track.keyword = keyword;

      globalSeenKeys.add(key);
      collected.push(track);
      if (collected.length >= maxCount) return collected;
    }
  }
  return collected;
}

async function recommendFromHistory({
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
}) {
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
      const { UserKeywordBlacklist } = require('../models/user-keyword-blacklist');
      const userRecords = await UserKeywordBlacklist.findAll({ where: { userId } });
      userRecords.forEach(r => blacklistSet.add(normalizeText(r.keyword)));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load blacklist for user ${userId}`, { error: err.stack });
    }
  }

  const tagFrequencies = buildHistoryTagFrequencies(recentHistoryItems);
  const tagKeywordsRaw = buildHistoryTagKeywords(recentHistoryItems, TAG_KEYWORD_LIMIT + 26);
  const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw)
    .filter(k => !blacklistSet.has(k))
    .slice(0, TAG_KEYWORD_LIMIT + 6);

  const excludedTrackKeys = new Set();
  recentHistoryItems.forEach((entry) => {
    const key = getTrackKey(getTrackInfo(entry));
    if (key) excludedTrackKeys.add(key);
  });

  const globalSeenKeys = new Set();
  const recommendations = [];
  const keywordStats = [];
  const usedKeywords = [];

  let keywordsToTry = tagKeywords.length > 0 ? tagKeywords : ['music'];
  if (randomizeKeywordsCount && tagKeywords.length > 0) {
    keywordsToTry = [...tagKeywords]
      .sort(() => Math.random() - 0.5)
      .slice(0, randomizeKeywordsCount);
  }
  else {
    keywordsToTry = keywordsToTry.slice(0, 5);
  }
  const firstHalfTarget = Math.ceil(normalizedCount / 2);

  for (const keyword of keywordsToTry) {
    const currentTotal = recommendations.length;
    if (currentTotal >= normalizedCount) break;

    const popularItems = await fetchPopularByKeyword({
      keyword,
      limit: popularLimit,
      region,
    });

    if (!popularItems || popularItems.length === 0) {
      keywordStats.push({ keyword, rawCount: 0, collectedCount: 0 });
      continue;
    }

    usedKeywords.push(keyword);

    const isFirstKeyword = usedKeywords.length === 1;
    const maxToCollect = randomizeKeywordsCount
      ? Math.ceil(normalizedCount / keywordsToTry.length)
      : (isFirstKeyword ? Math.min(firstHalfTarget, normalizedCount - currentTotal) : (normalizedCount - currentTotal));

    const collected = await collectFromPopularItems({
      popularItems,
      searchTracks,
      excludedTrackKeys,
      globalSeenKeys,
      maxCount: maxToCollect,
      source: `history-tag-${usedKeywords.length}-popular`,
      keyword,
    });

    keywordStats.push({
      keyword,
      rawCount: popularItems.length,
      collectedCount: collected.length,
      limitApplied: isFirstKeyword && !randomizeKeywordsCount ? firstHalfTarget : null,
    });

    recommendations.push(...collected);
  }

  if (!recommendations.length) {
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

module.exports = {
  clampRecommendationCount,
  formatDuration,
  parseUserIdFromArg,
  recommendFromHistory,
  buildHistoryTagKeywords,
  dedupeSimilarKeywords,
  getBlacklistForGuild,
  isValidTagKeyword,
  normalizeText,
};
