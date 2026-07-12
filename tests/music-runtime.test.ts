import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { createMusicRuntime } from '../music/runtime';
import { GuildState, Track } from '../music/types';
import { GuildConfig } from '../music/models/guild-config';
import { initDb } from '../db/init';
import { sequelize } from '../db/sequelize';

describe('MusicRuntime Unit Tests', () => {
  it('should trigger playNext immediately when there is no current track', async () => {
    const guildStates = new Map<string, GuildState>();
    
    // Mock runtime utilities
    let playNextCalled = false;
    let resolvedCount = 0;

    const runtimeUtilsMock = {
      waitForReadyNode: async () => ({}) as any,
      joinOrMovePlayer: async (guild: any, channelId: string, voiceChannel: any) => {
        let state = guildStates.get(guild.id);
        if (!state) {
          state = {
            player: {} as any,
            queue: [],
            history: [],
            current: null,
            textChannelId: channelId,
            voiceChannelId: voiceChannel.id,
            playing: false,
            loop: false,
            auto: false,
            autoMood: null,
            autoRequesterId: null,
            autoPool: [],
          };
          guildStates.set(guild.id, state);
        }
        return state;
      },
      resolveTracks: async (query: string) => {
        resolvedCount++;
        return {
          tracks: [
            {
              encoded: `encoded_${query}`,
              info: { title: `Title of ${query}`, length: 3000 } as any,
            },
          ],
          playlistName: null,
        };
      },
      getCurrentTrackForGuild: async () => null,
      playNext: async (guildId: string) => {
        playNextCalled = true;
        const state = guildStates.get(guildId);
        if (state) {
          state.current = state.queue.shift() || null;
          state.playing = true;
        }
      },
    };

    const runtime = createMusicRuntime({
      guildStates,
      runtimeUtils: runtimeUtilsMock as any,
    });

    const mockContext = {
      guild: { id: 'guild-1', members: { fetch: async () => ({ voice: { channel: { id: 'voice-1' } } }) } },
      channelId: 'text-1',
      member: { voice: { channel: { id: 'voice-1' } } },
      author: { id: 'user-1' },
    };

    // Play first song
    const res = await runtime.play(mockContext, 'song-1');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(playNextCalled, true, 'playNext should be triggered immediately');
    
    const state = guildStates.get('guild-1');
    assert.ok(state);
    assert.strictEqual(state.current?.encoded, 'encoded_song-1');
    assert.strictEqual(state.queue.length, 0);
  });

  it('should NOT trigger playNext and preserve the queue when there is an active current track (e.g. paused)', async () => {
    const guildStates = new Map<string, GuildState>();
    
    let playNextCalledCount = 0;

    const runtimeUtilsMock = {
      waitForReadyNode: async () => ({}) as any,
      joinOrMovePlayer: async (guild: any, channelId: string, voiceChannel: any) => {
        let state = guildStates.get(guild.id);
        if (!state) {
          state = {
            player: {} as any,
            queue: [],
            history: [],
            current: null,
            textChannelId: channelId,
            voiceChannelId: voiceChannel.id,
            playing: false,
            loop: false,
            auto: false,
            autoMood: null,
            autoRequesterId: null,
            autoPool: [],
          };
          guildStates.set(guild.id, state);
        }
        return state;
      },
      resolveTracks: async (query: string) => {
        return {
          tracks: [
            {
              encoded: `encoded_${query}`,
              info: { title: `Title of ${query}`, length: 3000 } as any,
            },
          ],
          playlistName: null,
        };
      },
      getCurrentTrackForGuild: async () => null,
      playNext: async (guildId: string) => {
        playNextCalledCount++;
        const state = guildStates.get(guildId);
        if (state) {
          state.current = state.queue.shift() || null;
          state.playing = true;
        }
      },
    };

    const runtime = createMusicRuntime({
      guildStates,
      runtimeUtils: runtimeUtilsMock as any,
    });

    const mockContext = {
      guild: { id: 'guild-1', members: { fetch: async () => ({ voice: { channel: { id: 'voice-1' } } }) } },
      channelId: 'text-1',
      member: { voice: { channel: { id: 'voice-1' } } },
      author: { id: 'user-1' },
    };

    // Play first song -> starts playing
    await runtime.play(mockContext, 'song-1');
    assert.strictEqual(playNextCalledCount, 1);

    const state = guildStates.get('guild-1');
    assert.ok(state);
    
    // Simulate pausing
    state.playing = false; // paused! but state.current is still 'song-1'

    // Play second song while paused
    playNextCalledCount = 0; // reset counter
    const res = await runtime.play(mockContext, 'song-2');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(playNextCalledCount, 0, 'playNext should NOT be called again if current track is active');
    
    // Current track remains song-1, song-2 is pushed to queue
    assert.strictEqual(state.current?.encoded, 'encoded_song-1');
    assert.strictEqual(state.queue.length, 1);
    assert.strictEqual(state.queue[0].encoded, 'encoded_song-2');
  });

  it('should route notifications to the configured channel in GuildConfig if set', async () => {
    await sequelize.query('DROP TABLE "GUILD_CONFIG"').catch(() => {});
    await initDb();
    
    // DB 설정 추가
    const targetGuildId = 'guild-1';
    const targetMusicChannelId = 'configured-text-channel-999';
    const existingConfig = await GuildConfig.findOne({ where: { guildId: targetGuildId } });
    if (existingConfig) {
      await existingConfig.update({ musicChannelId: targetMusicChannelId });
    } else {
      await GuildConfig.create({ guildId: targetGuildId, musicChannelId: targetMusicChannelId });
    }

    const guildStates = new Map<string, GuildState>();
    let passedTextChannelId = '';

    const runtimeUtilsMock = {
      waitForReadyNode: async () => ({}) as any,
      joinOrMovePlayer: async (guild: any, channelId: string, voiceChannel: any) => {
        passedTextChannelId = channelId;
        return {
          player: {} as any,
          queue: [],
          history: [],
          current: null,
          textChannelId: channelId,
          voiceChannelId: voiceChannel.id,
          playing: false,
          loop: false,
          auto: false,
          autoMood: null,
          autoRequesterId: null,
          autoPool: [],
        } as any;
      },
      resolveTracks: async (query: string) => {
        return {
          tracks: [{ encoded: `encoded_${query}`, info: { title: `Title of ${query}`, length: 3000 } as any }],
          playlistName: null,
        };
      },
      getCurrentTrackForGuild: async () => null,
      playNext: async () => {},
    };

    const runtime = createMusicRuntime({
      guildStates,
      runtimeUtils: runtimeUtilsMock as any,
    });

    const mockContext = {
      guild: { id: 'guild-1', members: { fetch: async () => ({ voice: { channel: { id: 'voice-1' } } }) } },
      channelId: 'default-text-channel',
      member: { voice: { channel: { id: 'voice-1' } } },
      author: { id: 'user-1' },
    };

    await runtime.play(mockContext, 'song-test');
    
    assert.strictEqual(passedTextChannelId, 'configured-text-channel-999');

    // 정리
    await GuildConfig.destroy({ where: { guildId: 'guild-1' } });
  });

  after(async () => {
    await sequelize.close();
  });
});

