import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sequelize } from '../db/sequelize';
import { initKeywordPinModel, KeywordPin } from '../music/models/keyword-pin';
import { initUserKeywordPinModel, UserKeywordPin } from '../music/models/user-keyword-pin';
import { initKeywordBlacklistModel } from '../music/models/keyword-blacklist';
import { initUserKeywordBlacklistModel } from '../music/models/user-keyword-blacklist';
import { recommendFromHistory } from '../music/services/recommand-service';
import { Track } from '../music/types';

describe('KeywordPin Model & Recommendation Integration Tests', () => {
  before(async () => {
    await sequelize.authenticate();
    initKeywordPinModel(sequelize);
    initUserKeywordPinModel(sequelize);
    initKeywordBlacklistModel(sequelize);
    initUserKeywordBlacklistModel(sequelize);
    
    await KeywordPin.destroy({
      where: {
        guildId: ['test-guild-pin-user', 'test-guild-pin-guild'],
      }
    });
    await UserKeywordPin.destroy({
      where: {
        userId: ['test-user-pin-user', 'test-user-pin-guild'],
      }
    });
  });

  after(async () => {
    await KeywordPin.destroy({
      where: {
        guildId: ['test-guild-pin-user', 'test-guild-pin-guild'],
      }
    });
    await UserKeywordPin.destroy({
      where: {
        userId: ['test-user-pin-user', 'test-user-pin-guild'],
      }
    });
    await sequelize.close();
  });

  it('should only prioritize user pinned keywords when userId is provided', async () => {
    // 1. 길드 핀 생성
    await KeywordPin.create({
      guildId: 'test-guild-pin-user',
      keyword: 'pin-guild-tag'
    });

    // 2. 유저 핀 생성
    await UserKeywordPin.create({
      userId: 'test-user-pin-user',
      keyword: 'pin-user-tag'
    });

    const dummyHistory = [
      {
        guildId: 'test-guild-pin-user',
        musicInfo: {
          info: { title: 'Song 1', author: 'Artist 1', uri: 'https://youtube.com/1' },
          tags: ['normal-tag-1', 'normal-tag-2']
        }
      }
    ];

    // Mock searchTracks: 키워드에 따라 다른 트랙을 리턴함
    const searchTracksMock = async (query: string) => {
      if (query === 'pin user tag') {
        return {
          tracks: [
            {
              encoded: 'enc1',
              info: { title: 'User Pin Song 1', author: 'Artist A', uri: 'https://youtube.com/user1', length: 180000, identifier: 'user1' }
            }
          ] as unknown as Track[]
        };
      }
      return { tracks: [] };
    };

    // guildId, userId 지정해서 핀 조회 및 정렬 테스트
    const result = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-pin-user',
      userId: 'test-user-pin-user'
    });

    // 개인 추천이므로 유저 핀만 결과에 들어가고 길드 핀은 배제되어야 함
    assert.ok(result.keywords.includes('pin user tag'), 'pin user tag should be present in keywords');
    assert.ok(!result.keywords.includes('pin guild tag'), 'pin guild tag should NOT be present in keywords');
    assert.strictEqual(result.items[0].info.title, 'User Pin Song 1');
  });

  it('should only prioritize guild pinned keywords when userId is not provided', async () => {
    // 1. 길드 핀 생성
    await KeywordPin.create({
      guildId: 'test-guild-pin-guild',
      keyword: 'pin-guild-tag'
    });

    // 2. 유저 핀 생성
    await UserKeywordPin.create({
      userId: 'test-user-pin-guild',
      keyword: 'pin-user-tag'
    });

    const dummyHistory = [
      {
        guildId: 'test-guild-pin-guild',
        musicInfo: {
          info: { title: 'Song 1', author: 'Artist 1', uri: 'https://youtube.com/1' },
          tags: ['normal-tag-1', 'normal-tag-2']
        }
      }
    ];

    // Mock searchTracks: 키워드에 따라 다른 트랙을 리턴함
    const searchTracksMock = async (query: string) => {
      if (query === 'pin guild tag') {
        return {
          tracks: [
            {
              encoded: 'enc2',
              info: { title: 'Guild Pin Song 1', author: 'Artist B', uri: 'https://youtube.com/guild1', length: 200000, identifier: 'guild1' }
            }
          ] as unknown as Track[]
        };
      }
      return { tracks: [] };
    };

    // guildId 지정, userId는 null로 해서 서버 핀 테스트
    const result = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-pin-guild',
      userId: null
    });

    // 서버 추천이므로 길드 핀만 결과에 들어가고 유저 핀은 배제되어야 함
    assert.ok(result.keywords.includes('pin guild tag'), 'pin guild tag should be present in keywords');
    assert.ok(!result.keywords.includes('pin user tag'), 'pin user tag should NOT be present in keywords');
    assert.strictEqual(result.items[0].info.title, 'Guild Pin Song 1');
  });

  it('should automatically resolve partial keyword to full tag in runtime addKeywordPin', async () => {
    const { MusicHistory } = require('../music/models/music-history');
    const { initMusicHistoryModel } = require('../music/models/music-history');
    initMusicHistoryModel(sequelize);

    const guildId = 'test-guild-pin-guild';
    await MusicHistory.destroy({ where: { guildId } });
    await MusicHistory.create({
      guildId,
      musicInfo: {
        info: { title: 'Deco Song', author: 'Deco', uri: 'http://youtube.com/deco' },
        tags: ['deco 27', 'vocaloid']
      }
    });

    const { createMusicRuntime } = require('../music/runtime');
    const runtime = createMusicRuntime({
      guildStates: new Map(),
      runtimeUtils: {} as any
    });

    await KeywordPin.destroy({ where: { guildId } });
    const res = await runtime.addKeywordPin(guildId, 'deco', false);
    assert.strictEqual(res.ok, true, 'Pin should be added successfully');

    const records = await KeywordPin.findAll({ where: { guildId } });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].keyword, 'deco 27', 'Partial keyword deco should be resolved to deco 27');

    await KeywordPin.destroy({ where: { guildId } });
    await MusicHistory.destroy({ where: { guildId } });
  });

  it('should include pinned keyword in getKeywords even if frequency is 0 and missing from history', async () => {
    const guildId = 'test-guild-pin-guild';
    const { MusicHistory } = require('../music/models/music-history');
    await MusicHistory.destroy({ where: { guildId } });

    await KeywordPin.destroy({ where: { guildId } });
    await KeywordPin.create({
      guildId,
      keyword: 'zero-freq-pin'
    });

    const { createMusicRuntime } = require('../music/runtime');
    const runtime = createMusicRuntime({
      guildStates: new Map(),
      runtimeUtils: {} as any
    });

    const res = await runtime.getKeywords(guildId, 'any-user', false);
    assert.strictEqual(res.ok, true);
    
    const pinItem = res.keywords.find(k => k.tag === 'zero freq pin');
    assert.ok(pinItem, 'zero freq pin should be present in getKeywords results');
    assert.strictEqual(pinItem.freq, 0, 'Frequency of zero freq pin should be 0');
    assert.strictEqual(pinItem.isPinned, true, 'isPinned of zero freq pin should be true');

    await KeywordPin.destroy({ where: { guildId } });
  });
});

describe('selectRandomKeywords Unit Tests', () => {
  const { selectRandomKeywords } = require('../music/services/recommand-service');

  it('should always include all pinned keywords if they are fewer than selectSize', () => {
    const pins = ['pin1', 'pin2'];
    const tags = ['tag1', 'tag2', 'tag3', 'tag4'];
    
    // 10번 반복 실행하여 항상 pin1과 pin2가 결과에 들어가 있는지 검증
    for (let i = 0; i < 10; i++) {
      const selected = selectRandomKeywords(pins, tags, 5, 3);
      assert.strictEqual(selected.length, 3);
      assert.ok(selected.includes('pin1'), 'pin1 should be included');
      assert.ok(selected.includes('pin2'), 'pin2 should be included');
    }
  });
});
