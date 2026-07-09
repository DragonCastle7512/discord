import { describe, it } from 'node:test';
import assert from 'node:assert';

// CommonJS로 내보내진 모듈을 가져옵니다.
import musicSkill = require('../ai/skills/music-skill');

describe('Music Skill Tools Tests', () => {
  // 1. 대기열(큐) 조작 도구 검증
  it('should declare move_queue_item and remove_queue_item tools', () => {
    const declarations = musicSkill.music_declarations;
    const moveTool = declarations.find(d => d.name === 'move_queue_item');
    const removeTool = declarations.find(d => d.name === 'remove_queue_item');

    assert.ok(moveTool, 'move_queue_item tool should be declared');
    assert.ok(removeTool, 'remove_queue_item tool should be declared');
  });

  it('should call moveQueueItem from handler', async () => {
    let called = false;
    let passedGuildId = '';
    let passedFrom = 0;
    let passedTo = 0;

    const mockObj = {
      message: { guild: { id: 'guild-abc' } },
      context: {
        music: {
          moveQueueItem: (guildId: string, fromIndex: number, toIndex: number) => {
            called = true;
            passedGuildId = guildId;
            passedFrom = fromIndex;
            passedTo = toIndex;
            return { ok: true, message: 'Moved successfully' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.move_queue_item;
    assert.ok(handler, 'move_queue_item handler should exist');

    const result = await handler({ fromIndex: 2, toIndex: 5 }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedGuildId, 'guild-abc');
    assert.strictEqual(passedFrom, 2);
    assert.strictEqual(passedTo, 5);
    assert.deepStrictEqual(result, { ok: true, message: 'Moved successfully' });
  });

  it('should call removeQueueItem from handler', async () => {
    let called = false;
    let passedGuildId = '';
    let passedIndex = 0;

    const mockObj = {
      message: { guild: { id: 'guild-abc' } },
      context: {
        music: {
          removeQueueItem: (guildId: string, index: number) => {
            called = true;
            passedGuildId = guildId;
            passedIndex = index;
            return { ok: true, message: 'Removed successfully' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.remove_queue_item;
    assert.ok(handler, 'remove_queue_item handler should exist');

    const result = await handler({ index: 3 }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedGuildId, 'guild-abc');
    assert.strictEqual(passedIndex, 3);
    assert.deepStrictEqual(result, { ok: true, message: 'Removed successfully' });
  });

  // 2. 키워드 및 블랙리스트 관리 도구 검증
  it('should declare keyword and blacklist tools', () => {
    const declarations = musicSkill.music_declarations;
    const tools = [
      'get_keywords',
      'get_keyword_blacklist',
      'add_keyword_blacklist',
      'remove_keyword_blacklist',
      'get_keyword_pins',
      'add_keyword_pin',
      'remove_keyword_pin'
    ];
    for (const tool of tools) {
      assert.ok(declarations.find(d => d.name === tool), `${tool} tool should be declared`);
    }
  });

  it('should call getKeywords from handler', async () => {
    let called = false;
    let passedGuildId = '';
    let passedUserId = '';
    let passedIsPersonal = false;

    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          getKeywords: async (guildId: string, userId: string, isPersonal: boolean) => {
            called = true;
            passedGuildId = guildId;
            passedUserId = userId;
            passedIsPersonal = isPersonal;
            return {
              ok: true,
              keywords: [{ tag: 'pop', freq: 5, isPinned: false }],
              blacklist: ['rock'],
              pinned: []
            };
          }
        }
      }
    };

    const handler = musicSkill.handlers.get_keywords;
    assert.ok(handler, 'get_keywords handler should exist');

    // personal mode test
    const resultPersonal = await handler({ mode: 'personal' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedGuildId, 'guild-abc');
    assert.strictEqual(passedUserId, 'user-abc');
    assert.strictEqual(passedIsPersonal, true);
    assert.deepStrictEqual(resultPersonal.keywords, [{ tag: 'pop', freq: 5, isPinned: false }]);

    // server mode test
    called = false;
    const resultServer = await handler({ mode: 'server' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedIsPersonal, false);
  });

  it('should call getKeywordBlacklist from handler', async () => {
    let called = false;
    let passedTargetId = '';
    let passedIsPersonal = false;

    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          getKeywordBlacklist: async (targetId: string, isPersonal: boolean) => {
            called = true;
            passedTargetId = targetId;
            passedIsPersonal = isPersonal;
            return { ok: true, keywords: ['rock', 'jazz'] };
          }
        }
      }
    };

    const handler = musicSkill.handlers.get_keyword_blacklist;
    assert.ok(handler, 'get_keyword_blacklist handler should exist');

    // personal mode
    const resPersonal = await handler({ mode: 'personal' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedTargetId, 'user-abc');
    assert.strictEqual(passedIsPersonal, true);
    assert.deepStrictEqual(resPersonal.keywords, ['rock', 'jazz']);

    // server mode
    called = false;
    const resServer = await handler({ mode: 'server' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedTargetId, 'guild-abc');
    assert.strictEqual(passedIsPersonal, false);
  });

  it('should call addKeywordBlacklist from handler', async () => {
    let called = false;
    let passedTargetId = '';
    let passedKeyword = '';
    let passedIsPersonal = false;

    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          addKeywordBlacklist: async (targetId: string, keyword: string, isPersonal: boolean) => {
            called = true;
            passedTargetId = targetId;
            passedKeyword = keyword;
            passedIsPersonal = isPersonal;
            return { ok: true, message: 'Added' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.add_keyword_blacklist;
    const res = await handler({ keyword: 'pop', mode: 'personal' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.strictEqual(passedTargetId, 'user-abc');
    assert.strictEqual(passedKeyword, 'pop');
    assert.strictEqual(passedIsPersonal, true);
    assert.deepStrictEqual(res, { ok: true, message: 'Added' });
  });

  it('should call removeKeywordBlacklist from handler', async () => {
    let called = false;
    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          removeKeywordBlacklist: async (targetId: string, keyword: string, isPersonal: boolean) => {
            called = true;
            return { ok: true, message: 'Removed' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.remove_keyword_blacklist;
    const res = await handler({ keyword: 'pop', mode: 'server' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.deepStrictEqual(res, { ok: true, message: 'Removed' });
  });

  it('should call getKeywordPins from handler', async () => {
    let called = false;
    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          getKeywordPins: async (targetId: string, isPersonal: boolean) => {
            called = true;
            return { ok: true, keywords: ['k-pop'] };
          }
        }
      }
    };

    const handler = musicSkill.handlers.get_keyword_pins;
    const res = await handler({ mode: 'personal' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.deepStrictEqual(res.keywords, ['k-pop']);
  });

  it('should call addKeywordPin from handler', async () => {
    let called = false;
    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          addKeywordPin: async (targetId: string, keyword: string, isPersonal: boolean) => {
            called = true;
            return { ok: true, message: 'Pinned' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.add_keyword_pin;
    const res = await handler({ keyword: 'k-pop', mode: 'server' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.deepStrictEqual(res, { ok: true, message: 'Pinned' });
  });

  it('should call removeKeywordPin from handler', async () => {
    let called = false;
    const mockObj = {
      message: { guild: { id: 'guild-abc' }, author: { id: 'user-abc' } },
      context: {
        music: {
          removeKeywordPin: async (targetId: string, keyword: string, isPersonal: boolean) => {
            called = true;
            return { ok: true, message: 'Unpinned' };
          }
        }
      }
    };

    const handler = musicSkill.handlers.remove_keyword_pin;
    const res = await handler({ keyword: 'k-pop', mode: 'personal' }, mockObj as any);
    assert.strictEqual(called, true);
    assert.deepStrictEqual(res, { ok: true, message: 'Unpinned' });
  });

  // 3. 에러 핸들링 및 예외 상황 테스트
  it('should return error when guildId is missing', async () => {
    const mockObjNoGuild = {
      message: { guild: null },
      context: { music: {} }
    };

    const moveResult = await musicSkill.handlers.move_queue_item({ fromIndex: 1, toIndex: 2 }, mockObjNoGuild as any);
    assert.strictEqual(moveResult.ok, false);
    assert.strictEqual(moveResult.reason, '서버 채널에서만 사용할 수 있습니다.');

    const removeResult = await musicSkill.handlers.remove_queue_item({ index: 1 }, mockObjNoGuild as any);
    assert.strictEqual(removeResult.ok, false);
    assert.strictEqual(removeResult.reason, '서버 채널에서만 사용할 수 있습니다.');
  });

  it('should return error when parameters are missing', async () => {
    const mockObj = {
      message: { guild: { id: 'guild-abc' } },
      context: { music: {} }
    };

    const moveResult1 = await musicSkill.handlers.move_queue_item({ toIndex: 2 } as any, mockObj as any);
    assert.strictEqual(moveResult1.ok, false);
    assert.strictEqual(moveResult1.reason, 'fromIndex와 toIndex는 필수 매개변수입니다.');

    const removeResult = await musicSkill.handlers.remove_queue_item({} as any, mockObj as any);
    assert.strictEqual(removeResult.ok, false);
    assert.strictEqual(removeResult.reason, 'index는 필수 매개변수입니다.');
  });

  it('should match partially/similar keywords for blacklist and pin', () => {
    const { isKeywordMatched } = require('../music/services/recommand-service');
    const blacklist = ['유즈하 리코'];
    const tag = '유즈하 리코 yuzuha riko';
    
    assert.strictEqual(isKeywordMatched(tag, blacklist), true, 'Should match similar tag in blacklist');
    assert.strictEqual(isKeywordMatched('random tag', blacklist), false, 'Should not match unrelated tag');
  });
});
