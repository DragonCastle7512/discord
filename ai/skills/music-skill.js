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
      name: 'play_music',
      description: `음악을 재생합니다. 
        1. 'query'를 비워둔 채 호출하면 플레이리스트(재생 목록)의 모든 곡을 재생합니다.
        2. 'query'에 곡 제목, 또는 유튜브 URL를 넣으면, 해당 곡을 재생합니다.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: '재생하고 싶은 노래 제목 또는 YouTube URL입니다. 플레이리스트 곡 재생 시에는 이 값을 생략하세요.',
          },
        },
        required: [],
      },
    },
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
      name: 'read_messages',
      description: '현재 채널의 최근 메시지를 읽습니다. 대화 흐름 파악, 요약, 특정 사용자 발화 확인에 사용합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          limit: {
            type: 'NUMBER',
            description: '읽어올 최근 메시지 개수 (1~50). 기본값: 10',
          },
        },
        required: [],
      },
    },
  ],

  handlers: {
    play_music: async (args, obj) => {
      const { message, context } = obj;
      try {
        const guildId = message?.guild?.id;
        const beforeQueue = guildId ? context.music.queue(guildId) : { count: 0 };
        const result = await context.music.play(message, args.query);
        const afterQueue = guildId ? context.music.queue(guildId) : { count: 0 };
        const queueIncreased = Number(afterQueue?.count || 0) > Number(beforeQueue?.count || 0);

        if (!result?.ok) {
          return {
            ok: false,
            requestedQuery: args?.query || null,
            reason: result?.message || '재생 실패',
          };
        }

        return {
          ok: true,
          requestedQuery: args?.query || null,
          message: result?.message || (args?.query ? `${args.query} 재생 요청 완료` : '플레이리스트 재생 요청 완료'),
          verification: {
            queueBefore: Number(beforeQueue?.count || 0),
            queueAfter: Number(afterQueue?.count || 0),
            queueIncreased,
            note: queueIncreased
              ? '큐 증가가 확인되었습니다.'
              : '큐 증가는 없지만 현재 곡 교체/즉시 재생 상태일 수 있습니다.',
          },
        };
      }
      catch (err) {
        return {
          ok: false,
          requestedQuery: args?.query || null,
          reason: `재생 중 예외가 발생했습니다: ${err?.message || err}`,
        };
      }
    },
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
      };;
    },
    read_messages: async (args, obj) => {
      const channel = obj?.message?.channel;
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        return '메시지를 읽을 수 없는 채널입니다.';
      }

      const fetchLimit = Math.max(1, Math.min(50, Number(args?.limit) || 10));

      try {
        const fetched = await channel.messages.fetch({ limit: fetchLimit + 1 });
        const messages = Array.from(fetched.values())
          .filter((msg) => msg.id !== obj.message.id)
          .filter((msg) => !msg.author?.bot)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .slice(-fetchLimit)
          .map((msg) => {
            const content = (msg.cleanContent || '').trim();
            const attachmentCount = msg.attachments?.size || 0;
            const normalized = content || (attachmentCount > 0 ? '[첨부 파일 메시지]' : '[텍스트 없음]');
            return {
              id: msg.id,
              authorId: msg.author?.id || 'unknown',
              author: msg.author?.username || 'unknown',
              createdAt: new Date(msg.createdTimestamp).toISOString(),
              content: normalized.slice(0, 500),
            };
          });

        return {
          count: messages.length,
          messages,
        };
      }
      catch (err) {
        return `디스코드 메시지 조회 실패: ${err?.message || err}`;
      }
    },
  },
};