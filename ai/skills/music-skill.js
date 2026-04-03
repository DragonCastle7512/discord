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

const parseIsoDurationToSeconds = (duration) => {
  if (!duration) {
    return null;
  }
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(duration);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 3600) + (minutes * 60) + seconds;
};

const isShortOrLongDuration = (duration) => {
  const seconds = parseIsoDurationToSeconds(duration);
  if (seconds === null) {
    return false;
  }
  return seconds <= 90 || seconds > 360;
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
      description: '유튜브 인기 음악을 조회합니다. 요청 수에 못 미치면 nextPageToken을 사용해 pageToken으로 재호출할 수 있습니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          keyword: {
            type: 'STRING',
            description: '검색 키워드 (곡명/아티스트 등). 제공 시 키워드 기반 인기곡 조회.',
          },
          order: {
            type: 'STRING',
            description: `검색 결과의 정렬 기준을 설정합니다. 반드시 아래 값 중 하나여야 합니다.
              1. 'date': 최근 업로드된 날짜 순으로 정렬
              2. 'relevance': 검색어와의 관련성이 높은 순으로 정렬 (기본값)
              3. 'viewCount': 조회수가 높은 순으로 정렬 (인기 순위 확인 시 권장)`,
          },
          limit: {
            type: 'NUMBER',
            description: '가져올 개수 (1~50). 기본값: 10',
          },
          pageToken: {
            type: 'STRING',
            description: '추가 검색 페이지 토큰. 이전 응답에서 nextPageToken을 담은 경우 사용하세요.',
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
    get_youtube_popular_music: async (args) => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return 'YOUTUBE_API_KEY가 설정되지 않았습니다. .env에 추가해주세요.';
      }

      const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10));
      const region = String(args?.region || 'KR').toUpperCase();
      const keyword = String(args?.keyword || '').trim();
      const pageToken = String(args?.pageToken || '').trim();
      const orderRaw = String(args?.order || '').trim().toLowerCase();
      const orderMap = {
        date: 'date',
        viewcount: 'viewCount',
      };
      const order = orderMap[orderRaw] || 'relevance';

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

        const searchUrl =
          'https://www.googleapis.com/youtube/v3/search' +
          `?part=snippet&type=video&videoCategoryId=10&order=${order}` +
          `&maxResults=50&q=${encodeURIComponent(keyword)} -shorts -short -틱톡 -tiktok` +
          '&topicId=/m/04rlf' +
          `&regionCode=${encodeURIComponent(region)}` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '') +
          `&key=${encodeURIComponent(apiKey)}`;

        const items = await searchYoutube(searchUrl);
        if (!items.length) {
          return '키워드 인기 음악 결과를 찾지 못했습니다.';
        }

        let filteredItems = items;
        const ids = items
            .map((item) => item?.id?.videoId)
            .filter((id) => typeof id === 'string' && id.length > 0);

        if (ids.length) {
          const detailsUrl =
            'https://www.googleapis.com/youtube/v3/videos' +
            `?part=contentDetails&id=${encodeURIComponent(ids.join(','))}` +
            `&key=${encodeURIComponent(apiKey)}`;

          try {
            const res = await fetch(detailsUrl);

            if (res.ok) {
              const detailsData = await res.json();
              const detailsItems = Array.isArray(detailsData?.items) ? detailsData.items : [];
              const detailsById = detailsItems.reduce((acc, item) => {
                if (item?.id) {
                  acc[item.id] = item?.contentDetails || {};
                }
                return acc;
              }, {});

              filteredItems = items.filter((item) => {
                const id = item?.id?.videoId;
                const duration = id ? detailsById?.[id]?.duration : null;
                if (!duration) {
                  return true;
                }
                return !isShortOrLongDuration(duration);
              });
            }
          }
          catch (err) {
            console.error(err);
          }
      }
      const nextToken = String(items?.nextPageToken || '');
      const response = buildListResponse(filteredItems, region, '키워드 인기 음악', keyword, {
        displayLimit: limit,
        requestedLimit: limit,
        nextPageToken: nextToken || null,
        filteredCount: filteredItems.length,
        filterApplied: true,
      });
      console.log(response?.text);
      return response;
    },
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