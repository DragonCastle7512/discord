import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sequelize } from '../db/sequelize';
import { initKeywordBlacklistModel, KeywordBlacklist } from '../music/models/keyword-blacklist';

describe('KeywordBlacklist Model Compatibility Tests', () => {
  before(async () => {
    await sequelize.authenticate();
    initKeywordBlacklistModel(sequelize);
    await KeywordBlacklist.destroy({ 
      where: { 
        keyword: ['test-keyword-xyz', 'blacklist-tag'],
      } 
    });
  });

  after(async () => {
    await KeywordBlacklist.destroy({ 
      where: { 
        keyword: ['test-keyword-xyz', 'blacklist-tag'],
      } 
    });
    await sequelize.close();
  });

  it('should successfully create and delete blacklist keyword', async () => {
    const record = await KeywordBlacklist.create({
      guildId: 'test-guild-x',
      keyword: 'test-keyword-xyz'
    });

    assert.ok(record.id, 'id should be populated');
    assert.strictEqual(record.guildId, 'test-guild-x');
    assert.strictEqual(record.keyword, 'test-keyword-xyz');

    const found = await KeywordBlacklist.findOne({ 
      where: { 
        guildId: 'test-guild-x', 
        keyword: 'test-keyword-xyz' 
      } 
    });
    assert.ok(found);

    await KeywordBlacklist.destroy({ 
      where: { 
        guildId: 'test-guild-x', 
        keyword: 'test-keyword-xyz' 
      } 
    });
    const notFound = await KeywordBlacklist.findOne({ 
      where: { 
        guildId: 'test-guild-x', 
        keyword: 'test-keyword-xyz' 
      } 
    });
    assert.strictEqual(notFound, null);
  });

  it('should filter out blacklisted keywords in recommendFromHistory scoped by guildId', async () => {
    await KeywordBlacklist.create({ 
      guildId: 'test-guild-A', 
      keyword: 'blacklist-tag' 
    });

    const { recommendFromHistory } = require('../music/services/recommand-service');

    const dummyHistory = [
      {
        guildId: 'test-guild-A',
        musicInfo: {
          info: { title: 'Song 1', author: 'Artist 1', uri: 'https://youtube.com/1' },
          tags: ['normal-tag', 'blacklist-tag', 'another-tag']
        }
      }
    ];

    const fetchPopularMock = async () => [];
    const searchTracksMock = async () => ({ tracks: [] });

    // 1. guildId 'test-guild-A' 로 계산 시 - 차단되어야 함
    const resultGuildA = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      fetchPopularByKeyword: fetchPopularMock,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-A'
    });

    assert.ok(resultGuildA.keywords.includes('normal tag'), 'normal tag should be present');
    assert.ok(!resultGuildA.keywords.includes('blacklist tag'), 'blacklist tag should be filtered out on Guild A');

    // 2. 다른 guildId 'test-guild-B' 로 계산 시 - 차단되지 않아야 함
    const resultGuildB = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      fetchPopularByKeyword: fetchPopularMock,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-B'
    });

    assert.ok(resultGuildB.keywords.includes('blacklist tag'), 'blacklist tag should NOT be filtered out on Guild B');

    await KeywordBlacklist.destroy({ 
      where: { 
        guildId: 'test-guild-A', 
        keyword: 'blacklist-tag' 
      } 
    });
  });
});
