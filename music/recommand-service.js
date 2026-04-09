const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const HISTORY_LIMIT = 100;
const POPULAR_LIMIT = 50;
const TAG_KEYWORD_LIMIT = 4;
const KEYWORD_SIMILARITY_THRESHOLD = 0.8;
const MIN_TAG_KEYWORD_LENGTH = 4;
const MIN_DURATION_MS = 90 * 1000;
const MAX_DURATION_MS = 6 * 60 * 1000;

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

function isDurationInRange(durationMs) {
  return Number.isFinite(durationMs) && durationMs >= MIN_DURATION_MS && durationMs <= MAX_DURATION_MS;
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

  historyItems.forEach((entry) => {
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
  historyItems.forEach((entry) => {
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
  for (const item of popularItems || []) {
    const videoUrl = item?.url || (item?.id ? `https://www.youtube.com/watch?v=${item.id}` : '');
    if (!videoUrl) continue;

    let resolved;
    try {
      resolved = await searchTracks(videoUrl);
    }
    catch {
      continue;
    }

    const first = Array.isArray(resolved?.tracks) ? resolved.tracks[0] : null;
    if (!first) continue;

    const track = getTrackInfo(first);
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
    if (collected.length >= maxCount) break;
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
}) {
  const normalizedCount = clampRecommendationCount(count);
  const recentHistoryItems = (Array.isArray(historyItems) ? historyItems : []).slice(0, historyLimit);

  if (!recentHistoryItems.length) {
    return {
      ok: false,
      reason: 'No history found for recommendation.',
      count: 0,
      historyUsed: 0,
      items: [],
      keywords: [],
      tagFrequencies: [],
    };
  }

  const tagFrequencies = buildHistoryTagFrequencies(recentHistoryItems);
  const tagKeywordsRaw = buildHistoryTagKeywords(recentHistoryItems, TAG_KEYWORD_LIMIT + 6);
  const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw);

  const firstKeyword = tagKeywords[0] || 'music';
  const secondKeyword = tagKeywords.find((tag) => tag !== firstKeyword) || 'music';

  const excludedTrackKeys = new Set();
  recentHistoryItems.forEach((entry) => {
    const key = getTrackKey(getTrackInfo(entry));
    if (key) excludedTrackKeys.add(key);
  });

  const [firstPopularItems, secondPopularItems] = await Promise.all([
    fetchPopularByKeyword({ keyword: firstKeyword, limit: popularLimit, region }),
    fetchPopularByKeyword({ keyword: secondKeyword, limit: popularLimit, region }),
  ]);

  if (!firstPopularItems.length && !secondPopularItems.length) {
    return {
      ok: false,
      reason: 'No popular results found for recommendation keywords.',
      count: 0,
      historyUsed: recentHistoryItems.length,
      items: [],
      keywords: [firstKeyword, secondKeyword],
      tagFrequencies,
    };
  }

  const firstTarget = Math.max(1, Math.ceil(normalizedCount * 0.6));
  const secondTarget = Math.max(0, normalizedCount - firstTarget);

  const globalSeenKeys = new Set();
  const firstCandidates = await collectFromPopularItems({
    popularItems: firstPopularItems,
    searchTracks,
    excludedTrackKeys,
    globalSeenKeys,
    maxCount: Math.max(normalizedCount * 2, firstTarget),
    source: 'history-tag-1-popular',
    keyword: firstKeyword,
  });

  const secondCandidates = await collectFromPopularItems({
    popularItems: secondPopularItems,
    searchTracks,
    excludedTrackKeys,
    globalSeenKeys,
    maxCount: Math.max(normalizedCount * 2, secondTarget + firstTarget),
    source: 'history-tag-2-popular',
    keyword: secondKeyword,
  });

  const selectedFirst = firstCandidates.slice(0, firstTarget);
  if (selectedFirst.length < firstTarget) {
    const used = new Set(selectedFirst.map((track) => getTrackKey(track)));
    for (const track of secondCandidates) {
      if (selectedFirst.length >= firstTarget) break;
      const key = getTrackKey(track);
      if (!key || used.has(key)) continue;
      used.add(key);
      track.source = 'history-tag-2-force-fill';
      selectedFirst.push(track);
    }
  }

  const selectedKeys = new Set(selectedFirst.map((track) => getTrackKey(track)));
  const selectedSecond = [];
  for (const track of secondCandidates) {
    if (selectedSecond.length >= secondTarget) break;
    const key = getTrackKey(track);
    if (!key || selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selectedSecond.push(track);
  }

  const recommendations = [...selectedFirst, ...selectedSecond].slice(0, normalizedCount);
  if (recommendations.length < normalizedCount) {
    for (const track of [...firstCandidates, ...secondCandidates]) {
      if (recommendations.length >= normalizedCount) break;
      const key = getTrackKey(track);
      if (!key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      recommendations.push(track);
    }
  }

  if (!recommendations.length) {
    return {
      ok: false,
      reason: 'No recommendation candidates left after filters.',
      count: 0,
      historyUsed: recentHistoryItems.length,
      items: [],
      keywords: [firstKeyword, secondKeyword],
      tagFrequencies,
    };
  }

  const displayOrder = interleaveBySource(recommendations, normalizedCount);
  return {
    ok: true,
    reason: null,
    count: displayOrder.length,
    historyUsed: recentHistoryItems.length,
    items: displayOrder,
    keywords: [firstKeyword, secondKeyword],
    tagFrequencies,
  };
}

module.exports = {
  clampRecommendationCount,
  formatDuration,
  parseUserIdFromArg,
  recommendFromHistory,
};
