import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sequelize } from '../db/sequelize';
import { initKeywordPinModel, KeywordPin } from '../music/models/keyword-pin';
import { initUserKeywordPinModel, UserKeywordPin } from '../music/models/user-keyword-pin';
import { recommendFromHistory } from '../music/services/recommand-service';
import { Track } from '../music/types';

describe('KeywordPin Model & Recommendation Integration Tests', () => {
  before(async () => {
    await sequelize.authenticate();
    initKeywordPinModel(sequelize);
    initUserKeywordPinModel(sequelize);
    
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
});
