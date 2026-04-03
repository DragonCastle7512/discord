module.exports = {
  util_declarations: [
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
    {
      name: 'react',
      description: '현재 채널의 특정 메세지에 이모지 반응을 추가합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          messageId: {
            type: 'STRING',
            description: '이모지 반응할 message ID',
          },
          emoji: {
            type: 'STRING',
            description: '이모지 종류 (예: <:name:123456789012345678>)',
          },
        },
        required: ['messageId', 'emoji'],
      },
    },
    {
      name: 'pin',
      description: '현재 채널에 메세지를 고정합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          messageId: {
            type: 'STRING',
            description: '고정시킬 message ID.',
          },
        },
        required: ['messageId'],
      },
    },
  ],
  handlers: {
    read_messages: async (args, obj) => {
      const channel = obj?.message?.channel;
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        return '메시지를 읽을 수 없는 채널입니다.';
      }

      const fetchLimit = Math.max(1, Math.min(50, Number(args?.limit) || 10));

      try {
        const fetched = await channel.messages.fetch({ limit: fetchLimit + 1 });
        const messages = Array.from(fetched.values())
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
    react: async (args, obj) => {
      const channel = obj?.message?.channel;
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        return {
          ok: false,
          reason: '존재하지 않는 채널입니다.',
        };
      }

      const messageId = String(args?.messageId || '').trim();
      const emojiRaw = String(args?.emoji || '').trim();
      if (!messageId || !emojiRaw) {
        return {
          ok: false,
          reason: 'messageId와 emoji가 필요합니다.',
        };
      }

      const customEmojiMatch = /^<a?:\w+:(\d+)>$/.exec(emojiRaw);
      const emoji = customEmojiMatch ? customEmojiMatch[1] : emojiRaw;

      try {
        const targetMessage = await channel.messages.fetch(messageId);
        await targetMessage.react(emoji);
        return {
          ok: true,
          action: 'react',
          messageId: targetMessage.id,
          emoji: emojiRaw,
        };
      }
      catch (err) {
        return {
          ok: false,
          action: 'react',
          messageId,
          reason: err?.message || String(err),
        };
      }
    },
    pin: async (args, obj) => {
      const channel = obj?.message?.channel;
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        return {
          ok: false,
          reason: '유효하지 않은 채널입니다.',
        };
      }

      const messageId = String(args?.messageId || '').trim();
      if (!messageId) {
        return {
          ok: false,
          reason: 'messageId가 필요합니다.',
        };
      }

      try {
        const targetMessage = await channel.messages.fetch(messageId);
        await targetMessage.pin();
        return {
          ok: true,
          action: 'pin',
          messageId: targetMessage.id,
        };
      }
      catch (err) {
        console.log(err);
        return {
          ok: false,
          action: 'pin',
          messageId,
          reason: err?.message || String(err),
        };
      }
    },
  },
};