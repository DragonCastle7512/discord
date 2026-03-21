const buildListResponse = (items, region, label, keyword) => {
  const lines = items.map((item, index) => {
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
    text: `${label} TOP ${items.length} (${region})${keywordLine}\n${lines.join('\n')}`,
    items: list,
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

const isShortDuration = (duration) => {
  const seconds = parseIsoDurationToSeconds(duration);
  if (seconds === null) {
    return false;
  }
  return seconds <= 60;
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
      name: 'get_youtube_popular_music',
      description: '유튜브 인기 음악 상위 N개를 조회합니다.',
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
  ],

  handlers: {
    play_music: async (args, obj) => {
      const { message, context } = obj;
      try {
        await context.music.play(message, args.query);
        if (!args.query) {
          return '플레이리스트 재생' ;
        }
        return `${args.query} 재생`;
      }
      catch (err) {
        return `재생할 수 없는 노래입니다: ${err}`;
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

      if (!keyword) {
        const url =
          'https://www.googleapis.com/youtube/v3/videos' +
          '?part=snippet,statistics&chart=mostPopular&videoCategoryId=10' +
          `&maxResults=${limit}&regionCode=${encodeURIComponent(region)}` +
          `&key=${encodeURIComponent(apiKey)}`;

        const items = await searchYoutube(url);
        if (!items.length) {
          return '인기 음악 결과를 찾지 못했습니다.';
        }

        return buildListResponse(items, region, '유튜브 인기 음악');
      }

      const searchUrl =
        'https://www.googleapis.com/youtube/v3/search' +
        '?part=snippet&type=video&videoCategoryId=10&order=viewCount' +
        `&maxResults=${limit}&q=${encodeURIComponent(keyword)}` +
        `&regionCode=${encodeURIComponent(region)}` +
        `&key=${encodeURIComponent(apiKey)}`;

      const items = await searchYoutube(searchUrl);
      if (!items.length) {
        return '키워드 인기 음악 결과를 찾지 못했습니다.';
      }
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

            const newItems = items.filter((item) => {
              const id = item?.id?.videoId;
              const duration = id ? detailsById?.[id]?.duration : null;
              if (!duration) {
                return true;
              }
              return !isShortDuration(duration);
            });

            return buildListResponse(newItems, region, '유튜브 인기 음악');
          }
        }
        catch (err) {
          console.error(err);
        }
      }
      return buildListResponse(items, region, '키워드 인기 음악', keyword);
    },
  },
};