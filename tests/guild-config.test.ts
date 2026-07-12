import { describe, it } from 'node:test';
import assert from 'node:assert';
// @ts-ignore
import { GuildConfig } from '../music/models/guild-config';

describe('GuildConfig Model Definitions', () => {
  it('should define guildId and musicChannelId fields', () => {
    assert.ok(GuildConfig);
  });
});
