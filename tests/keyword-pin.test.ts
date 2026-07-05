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
        guildId: 'test-guild-pin',
      }
    });
    await UserKeywordPin.destroy({
      where: {
        userId: 'test-user-pin',
      }
    });
  });

  after(async () => {
    await KeywordPin.destroy({
      where: {
        guildId: 'test-guild-pin',
      }
    });
    await UserKeywordPin.destroy({
      where: {
        userId: 'test-user-pin',
      }
    });
    await sequelize.close();
  });

  it('should successfully prioritize and interleave pinned keywords in recommendFromHistory via searchTracks', async () => {
    // 1. 길드 핀 생성
    await KeywordPin.create({
      guildId: 'test-guild-pin',
      keyword: 'pin-guild-tag'
    });

    // 2. 유저 핀 생성
    await UserKeywordPin.create({
      userId: 'test-user-pin',
      keyword: 'pin-user-tag'
    });

    const dummyHistory = [
      {
        guildId: 'test-guild-pin',
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

    // guildId, userId 지정해서 핀 조회 및 정렬 테스트
    const result = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-pin',
      userId: 'test-user-pin'
    });

    // 핀된 키워드가 결과 키워드 리스트의 첫 부분에 존재해야 함
    assert.ok(result.keywords.includes('pin user tag'), 'pin user tag should be present in keywords');
    assert.ok(result.keywords.includes('pin guild tag'), 'pin guild tag should be present in keywords');
    
    // 교차배치(Interleave)에 따라 유저 핀 트랙과 길드 핀 트랙이 순서대로 들어가 있어야 함
    assert.ok(result.items.length >= 2, 'Should return at least 2 items');
    assert.strictEqual(result.items[0].info.title, 'User Pin Song 1');
    assert.strictEqual(result.items[1].info.title, 'Guild Pin Song 1');
  });
});
