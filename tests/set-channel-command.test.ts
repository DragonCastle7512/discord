import { describe, it } from 'node:test';
import assert from 'node:assert';
// @ts-ignore
const setChannelCommand = require('../commands/music/set-channel.js');

describe('SetChannel Command definition', () => {
  it('should have standard SlashCommandBuilder properties', () => {
    assert.strictEqual(setChannelCommand.data.name, 'set-music-channel');
    assert.ok(setChannelCommand.execute);
  });
});
