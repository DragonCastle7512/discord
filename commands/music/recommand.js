const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');
const { handlers: musicSkillHandlers } = require('../../ai/skills/music-skill');

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const HISTORY_LIMIT = 50;
const POPULAR_LIMIT = 50;
const KEYWORD_TOP_K = 3;
const MIN_CURRENT_POOL_SIZE = 6;
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
  return normalized.split(' ').filter((token) => token.length >= 2);
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
  };
}

function pushByWeight(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topKeysByWeight(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function getTrackKey(track) {
  const uri = normalizeText(track.uri);
  if (uri) return `uri:${uri}`;
  const author = normalizeText(track.author);
  const title = normalizeText(track.title);
  return `meta:${author}|${title}`;
}

function clampCount(input) {
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

function getVideoIdFromUrl(url) {
  try {
    const value = String(url || '').trim();
    if (!value) return null;
    const u = new URL(value);
    if (u.hostname.toLowerCase() === 'youtu.be') {
      return u.pathname.replace('/', '') || null;
    }
    if (u.hostname.toLowerCase().includes('youtube.com')) {
      return u.searchParams.get('v');
    }
    return null;
  }
  catch {
    return null;
  }
}

function buildKeywordCandidates(historyItems, currentTrack) {
  const authorWeightMap = new Map();
  const titleTokenWeightMap = new Map();
  const keywords = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    keywords.push(normalized);
  };

  if (currentTrack?.author) {
    add(currentTrack.author);
  }

  historyItems.forEach((entry) => {
    const track = getTrackInfo(entry);
    if (track.author) {
      pushByWeight(authorWeightMap, track.author);
    }
    tokenize(track.title).forEach((token) => pushByWeight(titleTokenWeightMap, token));
  });

  const topAuthors = topKeysByWeight(authorWeightMap, KEYWORD_TOP_K);
  const topTokens = topKeysByWeight(titleTokenWeightMap, KEYWORD_TOP_K);
  topAuthors.forEach((author) => add(author));
  topTokens.forEach((token) => add(token));

  return keywords.slice(0, KEYWORD_TOP_K + 1);
}

function buildHistoryKeywordCandidates(historyItems, excludedKeyword) {
  const authorWeightMap = new Map();
  const titleTokenWeightMap = new Map();
  const excludedNorm = normalizeText(excludedKeyword);

  historyItems.forEach((entry) => {
    const track = getTrackInfo(entry);
    if (track.author) {
      pushByWeight(authorWeightMap, track.author);
    }
    tokenize(track.title).forEach((token) => pushByWeight(titleTokenWeightMap, token));
  });

  const merged = [
    ...topKeysByWeight(authorWeightMap, KEYWORD_TOP_K + 2),
    ...topKeysByWeight(titleTokenWeightMap, KEYWORD_TOP_K + 2),
  ];

  const result = [];
  const seen = new Set();
  merged.forEach((keyword) => {
    const normalized = normalizeText(keyword);
    if (!normalized) return;
    if (normalized === excludedNorm) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(keyword);
  });

  return result;
}

function includesKeyword(track, keyword) {
  const key = normalizeText(keyword);
  if (!key) return false;
  const target = `${normalizeText(track.title)} ${normalizeText(track.author)}`.trim();
  if (!target) return false;
  return target.includes(key);
}

async function collectFromPopularItems({
  popularItems,
  context,
  excludedTrackKeys,
  globalSeenKeys,
  maxCount,
  requiredKeyword,
  source,
}) {
  const collected = [];

  for (const item of popularItems) {
    const videoUrl = item?.url || (item?.id ? `https://www.youtube.com/watch?v=${item.id}` : '');
    if (!videoUrl) continue;

    let resolved;
    try {
      resolved = await context.music.searchTracks(videoUrl);
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
    if (requiredKeyword && !includesKeyword(track, requiredKeyword)) continue;

    const videoId = getVideoIdFromUrl(videoUrl);
    const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
    if (!track.artworkUrl && fallbackThumb) {
      track.artworkUrl = fallbackThumb;
    }
    track.source = source;

    globalSeenKeys.add(key);
    collected.push(track);
    if (collected.length >= maxCount) break;
  }

  return collected;
}

async function fetchPopularByKeyword(keyword, limit = POPULAR_LIMIT) {
  const output = await musicSkillHandlers.get_youtube_popular_music({
    keyword,
    order: 'viewCount',
    limit,
    region: 'KR',
  });

  if (typeof output === 'string') {
    return [];
  }
  if (!output || typeof output !== 'object' || !Array.isArray(output.items)) {
    return [];
  }
  return output.items;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommand')
    .setDescription('최근 재생 곡 기반으로 노래를 추천합니다.')
    .addStringOption((option) =>
      option
        .setName('count')
        .setDescription('추천 곡의 개수를 설정합니다.(최대 10곡)')
        .setRequired(false),
    ),
  async execute(interaction, context) {
    await interaction.deferReply();

    const count = clampCount(interaction.options.getString('count'));
    const currentTarget = Math.max(1, Math.ceil(count * 0.6));
    const historyTarget = Math.max(0, count - currentTarget);

    const historyResult = await context.music.history(interaction.guildId);
    const allHistoryItems = Array.isArray(historyResult?.items) ? historyResult.items : [];
    const recentHistoryItems = allHistoryItems.slice(0, HISTORY_LIMIT);
    const snapshot = context.music.getQueueSnapshot(interaction.guildId);
    const currentTrack = snapshot?.current ? getTrackInfo(snapshot.current) : null;
    const currentKeywordCandidates = buildKeywordCandidates(recentHistoryItems, currentTrack);
    const currentKeyword = currentKeywordCandidates[0] || 'music';
    const historyKeywordCandidates = buildHistoryKeywordCandidates(recentHistoryItems, currentKeyword);
    const historyKeyword = historyKeywordCandidates[0] || 'music';
    const historyFallbackKeyword = historyKeywordCandidates
      .find((keyword) => normalizeText(keyword) !== normalizeText(historyKeyword)) || '';

    const excludedTrackKeys = new Set();
    recentHistoryItems.forEach((entry) => {
      const key = getTrackKey(getTrackInfo(entry));
      if (key) {
        excludedTrackKeys.add(key);
      }
    });

    const currentPopularItems = await fetchPopularByKeyword(currentKeyword, POPULAR_LIMIT);
    const historyPopularItems = await fetchPopularByKeyword(historyKeyword, POPULAR_LIMIT);

    if (!currentPopularItems.length && !historyPopularItems.length) {
      const embed = buildEmbed('Recommendation', '추천 결과가 없습니다.', '0 result(s)');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const globalSeenKeys = new Set();
    const currentCandidates = await collectFromPopularItems({
      popularItems: currentPopularItems,
      context,
      excludedTrackKeys,
      globalSeenKeys,
      maxCount: Math.max(count * 2, currentTarget),
      source: 'current-popular',
    });
    const historyCandidates = await collectFromPopularItems({
      popularItems: historyPopularItems,
      context,
      excludedTrackKeys,
      globalSeenKeys,
      maxCount: Math.max(count * 2, historyTarget + currentTarget),
      source: 'history-popular',
    });

    const isCurrentKeywordUsable = currentCandidates.length >= MIN_CURRENT_POOL_SIZE;
    let historySecondaryCandidates = [];
    if (!isCurrentKeywordUsable && historyFallbackKeyword) {
      const historySecondaryPopularItems = await fetchPopularByKeyword(historyFallbackKeyword, POPULAR_LIMIT);
      historySecondaryCandidates = await collectFromPopularItems({
        popularItems: historySecondaryPopularItems.slice(0, count),
        context,
        excludedTrackKeys,
        globalSeenKeys,
        maxCount: count,
        requiredKeyword: historyFallbackKeyword,
        source: 'history-secondary-popular',
      });
    }

    const selectedCurrent = isCurrentKeywordUsable ? currentCandidates.slice(0, currentTarget) : [];
    if (selectedCurrent.length < currentTarget && historyCandidates.length > 0) {
      const preferred = historyFallbackKeyword
        ? [
          ...historySecondaryCandidates,
          ...historyCandidates.filter((track) => includesKeyword(track, historyFallbackKeyword)),
        ]
        : [];
      const rest = [
        ...historyCandidates.filter((track) => !preferred.includes(track)),
        ...historySecondaryCandidates.filter((track) => !preferred.includes(track)),
      ];
      const fillPool = [...preferred, ...rest];
      const usedKeys = new Set(selectedCurrent.map((track) => getTrackKey(track)));
      for (const track of fillPool) {
        if (selectedCurrent.length >= currentTarget) break;
        const key = getTrackKey(track);
        if (!key || usedKeys.has(key)) continue;
        usedKeys.add(key);
        track.source = historyFallbackKeyword ? 'history-fallback-current-replace' : (track.source || 'history-popular');
        selectedCurrent.push(track);
      }
    }

    const selectedKeys = new Set(selectedCurrent.map((track) => getTrackKey(track)));
    const selectedHistory = [];
    for (const track of [...historyCandidates, ...historySecondaryCandidates]) {
      if (selectedHistory.length >= historyTarget) break;
      const key = getTrackKey(track);
      if (!key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selectedHistory.push(track);
    }

    const recommendations = [...selectedCurrent, ...selectedHistory].slice(0, count);

    if (recommendations.length < count) {
      if (isCurrentKeywordUsable) {
        for (const track of currentCandidates) {
          if (recommendations.length >= count) break;
          const key = getTrackKey(track);
          if (!key || selectedKeys.has(key)) continue;
          selectedKeys.add(key);
          recommendations.push(track);
        }
      }
      for (const track of [...historyCandidates, ...historySecondaryCandidates]) {
        if (recommendations.length >= count) break;
        const key = getTrackKey(track);
        if (!key || selectedKeys.has(key)) continue;
        selectedKeys.add(key);
        recommendations.push(track);
      }
    }

    if (!recommendations.length) {
      const embed = buildEmbed(
        'Recommendation',
        '최근 재생한 20곡을 제외하면 인기곡이 없습니다.',
        '0 result(s)',
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const detailEmbeds = recommendations.map((track, idx) => {
      const durationText = formatDuration(track.length);
      const uriLine = track.uri ? `${track.uri}` : 'no url';
      const embed = new EmbedBuilder()
        .setColor(0xcd2929)
        .setTitle(`${idx + 1}. ${track.title} [${durationText}]`)
        .setDescription(`**Artist** - ${track.author || 'Unknown artist'}\n\n**URL**\n${uriLine}`)
        .setFooter({
          text: `추천 곡: ${idx + 1}/${recommendations.length}`,
        });

      if (track.artworkUrl) {
        embed.setThumbnail(track.artworkUrl);
      }
      return embed;
    });

    await interaction.editReply({ embeds: detailEmbeds });
  },
};
