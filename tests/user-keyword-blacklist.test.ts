import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sequelize } from '../db/sequelize';
import { initUserKeywordBlacklistModel, UserKeywordBlacklist } from '../music/models/user-keyword-blacklist';
import { initKeywordBlacklistModel } from '../music/models/keyword-blacklist';
import { isDurationInRange } from '../music/utils/track-parser';


describe('UserKeywordBlacklist Model Compatibility Tests', () => {
  before(async () => {
    await sequelize.authenticate();
    initUserKeywordBlacklistModel(sequelize);
    initKeywordBlacklistModel(sequelize);
    await UserKeywordBlacklist.destroy({ 
      where: { 
        userId: ['test-user-xyz', 'test-user-A'],
      } 
    });
  });

  after(async () => {
    await UserKeywordBlacklist.destroy({ 
      where: { 
        userId: 'test-user-xyz',
      } 
    });
    await sequelize.close();
  });

  it('should successfully create, find, and delete personal blacklist keyword', async () => {
    const record = await UserKeywordBlacklist.create({
      userId: 'test-user-xyz',
      keyword: 'test-keyword-abc'
    });

    assert.ok(record.id, 'id should be populated');
    assert.strictEqual(record.userId, 'test-user-xyz');
    assert.strictEqual(record.keyword, 'test-keyword-abc');

    const found = await UserKeywordBlacklist.findOne({ 
      where: { 
        userId: 'test-user-xyz', 
        keyword: 'test-keyword-abc' 
      } 
    });
    assert.ok(found);

    await UserKeywordBlacklist.destroy({ 
      where: { 
        userId: 'test-user-xyz', 
        keyword: 'test-keyword-abc' 
      } 
    });
    const notFound = await UserKeywordBlacklist.findOne({ 
      where: { 
        userId: 'test-user-xyz', 
        keyword: 'test-keyword-abc' 
      } 
    });
    assert.strictEqual(notFound, null);
  });

  it('should correctly filter history by userId and blacklist keywords in personal mode', async () => {
    await UserKeywordBlacklist.create({
      userId: 'test-user-xyz',
      keyword: 'personal-blacklist'
    });

    const dummyHistories = [
      {
        guildId: 'test-guild-1',
        musicInfo: {
          requestedBy: 'test-user-xyz',
          tags: ['pop-music', 'personal-blacklist', 'jazz-music']
        }
      },
      {
        guildId: 'test-guild-1',
        musicInfo: {
          requestedBy: 'another-user',
          tags: ['rock-music']
        }
      }
    ];

    const personalHistories = dummyHistories.filter(h => h.musicInfo.requestedBy === 'test-user-xyz');
    assert.strictEqual(personalHistories.length, 1);
    
    const { normalizeText } = require('../music/services/recommand-service');
    const tags = personalHistories.flatMap(h => h.musicInfo.tags);
    
    const blacklistRecords = await UserKeywordBlacklist.findAll({ where: { userId: 'test-user-xyz' } });
    const blacklistSet = new Set(blacklistRecords.map(r => r.keyword.toLowerCase().trim()));

    const filteredTags = tags
      .map(t => normalizeText(t))
      .filter(t => !blacklistSet.has(t));

    assert.ok(filteredTags.includes('pop music'));
    assert.ok(!filteredTags.includes('personal-blacklist'));
    assert.ok(!filteredTags.includes('rock-music'));

    await UserKeywordBlacklist.destroy({
      where: {
        userId: 'test-user-xyz',
        keyword: 'personal-blacklist'
      }
    });
  });

  it('should filter out user-specific blacklisted keywords in recommendFromHistory', async () => {
    await UserKeywordBlacklist.create({ 
      userId: 'test-user-A', 
      keyword: 'personal-blacklist-tag' 
    });

    const { recommendFromHistory } = require('../music/services/recommand-service');

    const dummyHistory = [
      {
        guildId: 'test-guild-A',
        musicInfo: {
          requestedBy: 'test-user-A',
          tags: ['normal-tag', 'personal-blacklist-tag']
        }
      }
    ];

    const fetchPopularMock = async () => [];
    const searchTracksMock = async () => ({ tracks: [] });

    // 1. userId가 'test-user-A' 인 경우 - 필터링 되어야 함
    const resultUserA = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      fetchPopularByKeyword: fetchPopularMock,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-A',
      userId: 'test-user-A'
    });

    assert.ok(resultUserA.keywords.includes('normal tag'), 'normal tag should be present');
    assert.ok(!resultUserA.keywords.includes('personal blacklist tag'), 'personal blacklist tag should be filtered out for User A');

    // 2. 다른 userId 'test-user-B' 인 경우 - 필터링되지 않아야 함
    const resultUserB = await recommendFromHistory({
      historyItems: dummyHistory,
      count: 5,
      fetchPopularByKeyword: fetchPopularMock,
      searchTracks: searchTracksMock,
      randomizeKeywordsCount: null,
      guildId: 'test-guild-A',
      userId: 'test-user-B'
    });

    assert.ok(resultUserB.keywords.includes('personal blacklist tag'), 'personal blacklist tag should NOT be filtered out for User B');

    await UserKeywordBlacklist.destroy({ 
      where: { 
        userId: 'test-user-A', 
        keyword: 'personal-blacklist-tag' 
      } 
    });
  });

  it('should correctly filter tracks by duration 1:30 to 6:00 in API response structure mock', () => {
    const mockTracks = [
      { info: { length: 80000, title: 'Too Short' } }, // 1m 20s
      { info: { length: 90000, title: 'Perfect 1' } }, // 1m 30s
      { info: { length: 300000, title: 'Perfect 2' } }, // 5m
      { info: { length: 360000, title: 'Perfect 3' } }, // 6m
      { info: { length: 400000, title: 'Too Long' } }, // 6m 40s
    ];

    const filtered = mockTracks.filter(t => isDurationInRange(t.info.length));
    assert.strictEqual(filtered.length, 3);
    assert.strictEqual(filtered[0].info.title, 'Perfect 1');
    assert.strictEqual(filtered[1].info.title, 'Perfect 2');
    assert.strictEqual(filtered[2].info.title, 'Perfect 3');
  });
});
