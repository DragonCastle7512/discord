function compactOptions(options) {
  const next = {};
  for (const [key, value] of Object.entries(options || {})) {
    if (value !== undefined && value !== null) {
      next[key] = value;
    }
  }
  return next;
}

async function executeSlash(obj, commandName, options = {}) {
  const invoker = obj?.context?.slashCommands;
  if (!invoker || typeof invoker.executeFromMessage !== 'function') {
    return {
      ok: false,
      reason: 'Slash command runtime is not available.',
    };
  }

  if (!invoker.listCommands().includes(commandName)) {
    return {
      ok: false,
      reason: `Unknown slash command: ${commandName}`,
      availableCommands: invoker.listCommands(),
    };
  }

  try {
    const result = await invoker.executeFromMessage(obj.message, commandName, compactOptions(options));
    return {
      ok: result?.ok === true,
      command: commandName,
      options: compactOptions(options),
      message: result?.message || null,
    };
  }
  catch (err) {
    return {
      ok: false,
      command: commandName,
      options: compactOptions(options),
      reason: err?.message || String(err),
    };
  }
}

module.exports = {
  command_declarations: [
    {
      name: 'slash_play',
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
      name: 'slash_add',
      description: '사용자의 플레이리스트에 노래를 추가합니다. music을 생략하면 현재 재생곡을 추가합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          music: {
            type: 'STRING',
            description: '노래 제목 또는 URL',
          },
        },
        required: [],
      },
    },
    {
      name: 'slash_clear',
      description: '사용자의 플레이리스트를 모두 비웁니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_history',
      description: '사용자에게 최근 재생한 음악 목록을 보여줍니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_loop',
      description: '반복 모드의 활성화/비활성화를 전환합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          enable: {
            type: 'BOOLEAN',
            description: '활성화(true) 또는 비활성화(false) 여부',
          },
        },
        required: [],
      },
    },
    {
      name: 'slash_playlist',
      description: '사용자에게 플레이리스트 목록과 조작 UI를 보여줍니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_queue',
      description: '사용자에게 현재 재생 대기열과 제어 UI를 보여줍니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_skip',
      description: '현재 재생 중인 곡을 건너뜁니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_stop',
      description: '모든 노래를 중지하고 음성 채널에서 나갑니다.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    },
    {
      name: 'slash_echo',
      description: '사용자에게 입력한 메시지를 채널에 전송합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          input: {
            type: 'STRING',
            description: '전송할 메시지',
          },
        },
        required: ['input'],
      },
    },
    {
      name: 'slash_tts',
      description: '입력한 문장을 TTS로 재생합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          input: {
            type: 'STRING',
            description: '읽을 문장',
          },
        },
        required: ['input'],
      },
    },
  ],
  handlers: {
    slash_play: async (args, obj) => executeSlash(obj, 'play', { query: args?.query }),
    slash_add: async (args, obj) => executeSlash(obj, 'add', { music: args?.music }),
    slash_clear: async (args, obj) => executeSlash(obj, 'clear'),
    slash_history: async (args, obj) => executeSlash(obj, 'history'),
    slash_loop: async (args, obj) => executeSlash(obj, 'loop', { enable: args?.enable }),
    slash_playlist: async (args, obj) => executeSlash(obj, 'playlist'),
    slash_queue: async (args, obj) => executeSlash(obj, 'queue'),
    slash_skip: async (args, obj) => executeSlash(obj, 'skip'),
    slash_stop: async (args, obj) => executeSlash(obj, 'stop'),
    slash_echo: async (args, obj) => executeSlash(obj, 'echo', { input: args?.input }),
    slash_tts: async (args, obj) => executeSlash(obj, 'tts', { input: args?.input }),
  },
};
