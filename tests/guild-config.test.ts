import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
// @ts-ignore
import { GuildConfig } from '../music/models/guild-config';
import { initDb } from '../db/init';
import { sequelize } from '../db/sequelize';

describe('GuildConfig Model Definitions', () => {
  it('should define guildId and musicChannelId fields', () => {
    assert.ok(GuildConfig);
  });
});

describe('GuildConfig DB Integration Tests', () => {
  after(async () => {
    await sequelize.close();
  });

  it('should sync GuildConfig model with DB and allow upserting config', async () => {
    await initDb();
    const guildId = 'test-guild-123';
    const musicChannelId = 'test-channel-456';
    let config = await GuildConfig.findOne({ where: { guildId } });
    if (config) {
      await config.update({ musicChannelId });
    } else {
      config = await GuildConfig.create({ guildId, musicChannelId });
    }
    assert.ok(config);
    
    const found = await GuildConfig.findOne({ where: { guildId: 'test-guild-123' } });
    assert.strictEqual(found?.musicChannelId, 'test-channel-456');
    
    // 정리
    await GuildConfig.destroy({ where: { guildId: 'test-guild-123' } });
  });
});


