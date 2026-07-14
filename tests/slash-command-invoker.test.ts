import { describe, it } from 'node:test';
import assert from 'node:assert';
// @ts-ignore
const { createSlashCommandInvoker } = require('../commands/slash-command-invoker');

describe('Slash Command Invoker - Options Resolver', () => {
  it('should support getChannel method with mentions and ids', async () => {
    const mockChannel = { id: '1234567890', name: 'music-channel', toString() { return '<#1234567890>'; } };
    
    const mockMessage = {
      client: {},
      guild: {
        id: 'guild-123',
        channels: {
          cache: {
            get: (id: string) => id === '1234567890' ? mockChannel : null,
            find: (fn: Function) => fn({ name: 'music-channel' }) ? mockChannel : null
          }
        }
      },
      guildId: 'guild-123',
      channel: {
        send: async () => ({})
      },
      channelId: 'channel-123',
      author: { id: 'user-123' },
      member: {}
    };

    let executedOptions: any = null;
    const mockCommands = new Map([
      ['test-cmd', {
        execute: async (interaction: any) => {
          executedOptions = interaction.options;
        }
      }]
    ]);

    const invoker = createSlashCommandInvoker({
      commands: mockCommands,
      context: {}
    });

    await invoker.executeFromMessage(mockMessage as any, 'test-cmd', { channel: '<#1234567890>' });
    
    assert.ok(executedOptions, 'execute should have populated executedOptions');
    assert.ok(typeof executedOptions.getChannel === 'function', 'getChannel should be a function');
    
    const channel = executedOptions.getChannel('channel');
    assert.ok(channel, 'Should find the channel');
    assert.deepStrictEqual(channel.id, '1234567890');
    assert.strictEqual(channel.toString(), '<#1234567890>');
  });
});

const utilSkill = require('../ai/skills/util-skill');

describe('get_guild_channels Tool Tests', () => {
  it('should declare get_guild_channels tool', () => {
    const declarations = utilSkill.util_declarations;
    const tool = declarations.find((d: any) => d.name === 'get_guild_channels');
    assert.ok(tool, 'get_guild_channels tool should be declared');
  });

  it('should return channels from handler', async () => {
    const mockChannel = { id: 'channel-abc', name: 'music-box', type: 0 };
    const mockObj = {
      message: {
        guild: {
          channels: {
            cache: {
              filter: () => ({
                map: (fn: Function) => [fn(mockChannel)]
              })
            }
          }
        }
      }
    };

    const handler = utilSkill.handlers.get_guild_channels;
    assert.ok(handler, 'get_guild_channels handler should exist');

    const result = await handler({}, mockObj as any);
    assert.deepStrictEqual(result, {
      ok: true,
      channels: [{ id: 'channel-abc', name: 'music-box' }]
    });
  });
});

