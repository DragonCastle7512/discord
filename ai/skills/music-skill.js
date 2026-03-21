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

      const youtubeUrl =
        'https://www.googleapis.com/youtube/v3/videos' +
        '?part=snippet,statistics&chart=mostPopular&videoCategoryId=10' +
        `&maxResults=${limit}&regionCode=${encodeURIComponent(region)}` +
        `&key=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(youtubeUrl);
        if (!res.ok) {
          const text = await res.text();
          return `YouTube API 요청 실패: ${res.status} ${res.statusText} - ${text}`;
        }
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
          return '인기 음악 결과를 찾지 못했습니다.';
        }
      }
      catch (err) {
        return `YouTube API 요청 중 오류: ${err?.message || err}`;
      }

      const lines = items.map((item, index) => {
        const title = item?.snippet?.title || 'Unknown title';
        const channel = item?.snippet?.channelTitle || 'Unknown channel';
        const id = item?.id;
        const url = id ? `https://www.youtube.com/watch?v=${id}` : 'No URL';
        return `${index + 1}. ${title} - ${channel} (${url})`;
      });

      return `유튜브 인기 음악 TOP ${items.length} (${region})\n${lines.join('\n')}`;
    },
  },
};