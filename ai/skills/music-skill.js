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
  ],

  handlers: {
    play_music: async (args, obj) => {
      const { message, context } = obj;
      await context.music.play(message, args.query);
      if (!args.query) {
        return '플레이리스트 재생' ;
      }
      return `${args.query} 재생`;
    },
  },
};