const {
  clampRecommendationCount,
  parseUserIdFromArg,
  recommendFromHistory,
} = require('../../music/services/recommand-service');
const { isDurationInRange } = require('../../music/utils/track-parser');
const { logger } = require('../../common/logger');


const buildListResponse = (items, region, label, keyword, meta = {}) => {
  const displayLimit = Number.isInteger(meta.displayLimit)
    ? Math.max(0, Math.min(meta.displayLimit, items.length))
    : items.length;
  const displayItems = items.slice(0, displayLimit);

  const lines = displayItems.map((item, index) => {
    const title = item?.snippet?.title || 'Unknown title';
    const channel = item?.snippet?.channelTitle || 'Unknown channel';
    const id = item?.id?.videoId || item?.id;
    const url = id ? `https://www.youtube.com/watch?v=${id}` : 'No URL';
    return `${index + 1}. ${title} - ${channel} (${url})`;
  });

  const list = items.map((item) => {
    const title = item?.snippet?.title || 'Unknown title';
    const channel = item?.snippet?.channelTitle || 'Unknown channel';
    const id = item?.id?.videoId || item?.id;
    const url = id ? `https://www.youtube.com/watch?v=${id}` : null;
    return { title, channel, url, id };
  });

  const keywordLine = keyword ? `\n키워드: ${keyword}` : '';
  return {
    text: `${label} TOP ${displayItems.length}/${items.length} (${region})${keywordLine}\n${lines.join('\n')}`,
    items: list,
    meta: {
      ...meta,
      totalItems: items.length,
      displayItems: displayItems.length,
    },
  };
};

async function getYoutubePopularMusic(args, obj) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return 'YOUTUBE_API_KEY가 설정되지 않았습니다. .env에 추가해주세요.';
  }

  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10));
  const region = String(args?.region || 'KR').toUpperCase();
  const keyword = String(args?.keyword || '').trim();

  if (!keyword) {
    const url =
      'https://www.googleapis.com/youtube/v3/videos' +
      '?part=snippet,statistics&chart=mostPopular&videoCategoryId=10' +
      `&maxResults=50&regionCode=${encodeURIComponent(region)}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const items = await searchYoutube(url);
    if (!items.length) {
      return '인기 음악 결과를 찾지 못했습니다.';
    }

    return buildListResponse(items, region, '유튜브 인기 음악', '', { displayLimit: limit });
  }

  if (keyword) {
    if (!obj?.context?.music) {
      return '음악 실행부 컨텍스트가 존재하지 않습니다.';
    }

    try {
      const searchRes = await obj.context.music.searchTracks(keyword);
      const rawTracks = searchRes?.tracks || [];

      // 1m 30s ~ 6m 재생 시간 필터링
      const filteredTracks = rawTracks.filter(t => isDurationInRange(t.info.length));

      if (!filteredTracks.length) {
        return '키워드 인기 음악 결과를 찾지 못했습니다.';
      }

      // buildListResponse 형식으로 매핑
      const mappedItems = filteredTracks.map(t => ({
        snippet: {
          title: t.info.title,
          channelTitle: t.info.author,
        },
        id: t.info.identifier,
      }));

      const response = buildListResponse(mappedItems, region, '키워드 인기 음악 (Lavalink)', keyword, {
        displayLimit: limit,
        requestedLimit: limit,
        filteredCount: mappedItems.length,
        filterApplied: true,
      });

      logger.info('ai', 'Lavalink keyword popular music skill output generated', { responseText: response?.text });
      return response;
    }
    catch (err) {
      logger.error('ai', `Lavalink search failed in getYoutubePopularMusic for keyword "${keyword}"`, { error: err.stack });
      return '인기 음악 결과를 검색하는 중 오류가 발생했습니다.';
    }
  }
}


const searchYoutube = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return `YouTube API 요청 실패: ${res.status} ${res.statusText} - ${text}`;
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  }
  catch (err) {
    return `YouTube API 요청 중 오류: ${err?.message || err}`;
  }
};

module.exports = {
  music_declarations: [
    {
      name: 'get_recent_played_music',
      description: '현재 서버에서 최근 재생한 음악 목록을 조회합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_youtube_popular_music',
      description: '유튜브 인기 음악을 조회합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          keyword: {
            type: 'STRING',
            description: '검색 키워드 (곡명/아티스트 등). 제공 시 키워드 기반 인기곡 조회.',
          },
          limit: {
            type: 'NUMBER',
            description: '가져올 개수 (1~50). 기본값: 10',
          },
          region: {
            type: 'STRING',
            description: '지역 코드 (예: KR, US). 기본값: KR',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_recommand_list',
      description: '히스토리 태그 기반 추천 목록을 JSON으로 반환합니다. user/userId를 주면 해당 사용자 기준으로 추천합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          user: {
            type: 'STRING',
            description: '추천 기준 사용자 ID 또는 멘션(예: 123..., <@123...>)',
          },
          count: {
            type: 'NUMBER',
            description: '추천 개수 (기본 5, 최대 20)',
          },
          region: {
            type: 'STRING',
            description: '국가 코드 (기본 KR)',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_playlist',
      description: '사용자의 플레이리스트 목록을 조회합니다. userId가 없으면 요청자의 목록을 조회합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: {
            type: 'STRING',
            description: '플레이리스트를 조회할 사용자 ID',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_queue',
      description: '현재 서버에서 재생 중인 곡과 대기열 목록을 조회합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
  ],

  handlers: {
    get_youtube_popular_music: getYoutubePopularMusic,
    get_recent_played_music: async (args, obj) => {
      const guildId = obj?.message?.guild?.id;
      if (!guildId) {
        return {
          ok: false,
          reason: '서버 채널에서만 사용할 수 있습니다.',
        };
      }

      const result = await obj?.context?.music?.history(guildId);
      return {
        ok: true,
        total: Number(result?.total || 0),
        items: result.items.map((track, index) => ({
          index: index + 1,
          title: track?.musicInfo?.info?.title || 'Unknown title',
          url: track?.musicInfo?.info?.uri || null,
          requestedBy: track?.musicInfo?.requestedBy || null,
          createAt: track?.createdAt || null,
        })),
      };
    },
    get_recommand_list: async (args, obj) => {
      const guildId = obj?.message?.guild?.id;
      if (!guildId) {
        return {
          ok: false,
          reason: 'GuildId가 존재하지 않습니다.',
        };
      }

      logger.info('ai', '[get_recommand_list] Tool invoked with args', { args, guildId });

      const count = clampRecommendationCount(args?.count);
      const region = String(args?.region || 'KR').toUpperCase();
      const targetUserId = parseUserIdFromArg(args?.user || args?.userId);
      const historyResult = await obj?.context?.music?.history(guildId, targetUserId || undefined);
      const allHistoryItems = Array.isArray(historyResult?.items) ? historyResult.items : [];

      logger.info('ai', `[get_recommand_list] History loaded for user: ${targetUserId || 'all'}`, { historyCount: allHistoryItems.length });

      const result = await recommendFromHistory({
        historyItems: allHistoryItems,
        count,
        searchTracks: (query) => obj?.context?.music?.searchTracks(query),
        region,
        guildId,
        userId: targetUserId || obj?.message?.author?.id || null,
      });

      if (!result.ok) {
        logger.warn('ai', '[get_recommand_list] Recommendation generation failed', { reason: result.reason, targetUserId });
        return {
          ok: false,
          reason: result.reason,
          guildId,
          userId: targetUserId || null,
          keywords: result.keywords || [],
          keywordStats: result.keywordStats || [],
          historyUsed: result.historyUsed || 0,
        };
      }

      logger.info('ai', '[get_recommand_list] Recommendation generated successfully', {
        keywords: result.keywords,
        recommendedCount: result.count,
        items: result.items.map(t => ({ title: t.info?.title, lengthMs: t.info?.length, uri: t.info?.uri })),
      });

      return {
        ok: true,
        guildId,
        userId: targetUserId || null,
        historyUsed: result.historyUsed,
        keywords: result.keywords,
        keywordStats: result.keywordStats,
        count: result.count,
        items: result.items.map((track, index) => {
          const info = track.info || {};
          return {
            index: index + 1,
            title: info.title || 'Unknown title',
            author: info.author || 'Unknown artist',
            url: info.uri || null,
            lengthMs: Number.isFinite(info.length) ? info.length : null,
            artworkUrl: info.artworkUrl || null,
            source: track.source || null,
            keyword: track.keyword || null,
          };
        }),
      };
    },
    get_playlist: async (args, obj) => {
      const fallbackUserId = obj?.message?.author?.id;
      const userId = String(args?.userId || fallbackUserId || '').trim();

      if (!userId) {
        return {
          ok: false,
          reason: 'userId가 없습니다.',
        };
      }

      const tracks = await obj?.context?.music?.getPlaylist(userId);
      const list = Array.isArray(tracks) ? tracks : [];

      return {
        ok: true,
        userId,
        total: list.length,
        items: list.map((track, index) => ({
          index: index + 1,
          title: track?.info?.title || 'Unknown title',
          url: track?.info?.uri || null,
          lengthMs: Number.isFinite(track?.info?.length) ? track.info.length : null,
          author: track?.info?.author || null,
        })),
      };
    },
    get_queue: async (args, obj) => {
      const guildId = obj?.message?.guild?.id;
      if (!guildId) {
        return {
          ok: false,
          reason: '서버 채널에서만 사용할 수 있습니다.',
        };
      }

      const snapshot = obj?.context?.music?.getQueueSnapshot(guildId);
      const current = snapshot?.current || null;
      const queue = Array.isArray(snapshot?.queue) ? snapshot.queue : [];

      return {
        ok: true,
        guildId,
        current: current
          ? {
            title: current?.info?.title || 'Unknown title',
            url: current?.info?.uri || null,
            lengthMs: Number.isFinite(current?.info?.length) ? current.info.length : null,
            requestedBy: current?.requestedBy || null,
          }
          : null,
        totalQueued: queue.length,
        items: queue.map((track, index) => ({
          index: index + 1,
          title: track?.info?.title || 'Unknown title',
          url: track?.info?.uri || null,
          lengthMs: Number.isFinite(track?.info?.length) ? track.info.length : null,
          requestedBy: track?.requestedBy || null,
        })),
      };
    },
  },
};