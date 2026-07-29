import { Client, TextChannel } from 'discord.js';
import { Shoukaku } from 'shoukaku';
import { GuildState, RuntimeUtils } from './types';
import { loadPlaybackStates, clearPlaybackStateSync } from './playback-state-store';
import { logger } from '../common/logger';

/**
 * 저장된 재생 상태를 바탕으로 음성 채널에 재입장하여 이전 곡 및 큐를 복구합니다.
 */
export async function restorePlaybackStates(deps: {
  client: Client;
  shoukaku: Shoukaku;
  guildStates: Map<string, GuildState>;
  runtimeUtils: RuntimeUtils;
}): Promise<void> {
  const { client, shoukaku, guildStates, runtimeUtils } = deps;

  logger.info('music', '[Restorer] Checking for saved playback states...');
  const savedStates = loadPlaybackStates();
  if (savedStates.length === 0) {
    logger.info('music', '[Restorer] No saved states to restore.');
    return;
  }

  logger.info('music', `[Restorer] Restoring playback states for ${savedStates.length} guild(s)...`);

  let restoredCount = 0;

  for (const savedState of savedStates) {
    try {
      console.log(`[Restorer] Attempting to restore guild: ${savedState.guildId}, voiceChannel: ${savedState.voiceChannelId}`);
      const guild = await client.guilds.fetch(savedState.guildId).catch((err) => {
        logger.warn('music', `[Restorer] Guild fetch failed (${savedState.guildId}): ${err.message}`);
        return null;
      });
      if (!guild) continue;

      const voiceChannel = await guild.channels.fetch(savedState.voiceChannelId).catch((err) => {
        logger.warn('music', `[Restorer] Voice channel fetch failed (${savedState.voiceChannelId}): ${err.message}`);
        return null;
      });
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        logger.warn('music', `[Restorer] Channel is not voice based or not found: ${savedState.voiceChannelId}`);
        continue;
      }

      // 1. 음성 채널 자동 재입장 및 GuildState 생성
      const state = await runtimeUtils.joinOrMovePlayer(
        guild,
        savedState.textChannelId || '',
        voiceChannel
      );

      // 복구 도중 player.on('end')가 큐를 삭제하지 못하도록 플래그 켜기
      state.isRestoring = true;

      // 2. 큐 및 옵션 상태 복원
      state.queue = Array.isArray(savedState.queue) ? [...savedState.queue] : [];
      state.history = Array.isArray(savedState.history) ? [...savedState.history] : [];
      state.loop = savedState.loop || false;
      state.auto = savedState.auto || false;
      state.autoMood = savedState.autoMood || null;
      state.current = savedState.current || null;

      // 3. 트랙 재생 & 멈췄던 위치로 seekTo
      if (savedState.current && state.player) {
        state.playing = true;
        state.trackStartedAt = Date.now() - (savedState.position || 0);
        state.accumulatedPosition = 0;

        await state.player.playTrack({ track: { encoded: savedState.current.encoded } });

        if (savedState.position > 1000) {
          // Lavalink가 트랙 세션을 안정적으로 여는 500ms 대기 후 seekTo 실행
          await new Promise((resolve) => setTimeout(resolve, 500));
          await state.player.seekTo(savedState.position).catch((err) => {
            logger.warn('music', `[Restorer] Failed to seek to ${savedState.position}ms: ${err.message}`);
          });
        }

        logger.info('music', `[Restorer] Successfully restored playback in guild ${guild.id} (Channel: ${voiceChannel.id}, Track: ${savedState.current.info?.title || 'Unknown'})`);
        console.log(`[Restorer] Successfully restored playback in guild ${guild.id} (Queue items: ${state.queue.length})`);
        restoredCount++;
      } else if (state.queue.length > 0) {
        await runtimeUtils.playNext(guild.id);
        restoredCount++;
      }

      // 복구 상태 완료 플래그 해제
      state.isRestoring = false;
    } catch (err: any) {
      logger.error('music', `[Restorer] Failed to restore playback state for guild ${savedState.guildId}: ${err.message}`, { error: err });
    }
  }

  // 복원 작업이 1개 이상 이루어졌거나 더 이상 복구할 게 없을 때만 파일 삭제
  if (restoredCount > 0) {
    clearPlaybackStateSync();
  }
}
