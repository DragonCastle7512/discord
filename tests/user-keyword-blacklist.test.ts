import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sequelize } from '../db/sequelize';
import { initUserKeywordBlacklistModel, UserKeywordBlacklist } from '../music/models/user-keyword-blacklist';

describe('UserKeywordBlacklist Model Compatibility Tests', () => {
  before(async () => {
    await sequelize.authenticate();
    initUserKeywordBlacklistModel(sequelize);
    await UserKeywordBlacklist.sync();
    await UserKeywordBlacklist.destroy({ 
      where: { 
        userId: 'test-user-xyz',
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
});
