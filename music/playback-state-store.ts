import fsSync from 'node:fs';
import path from 'node:path';
import { GuildState, Track } from './types';
import { logger } from '../common/logger';

export interface PersistedGuildState {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  current: Track | null;
  position: number;
  queue: Track[];
  history: Track[];
  loop: boolean;
  auto?: boolean;
  autoMood?: string | null;
}

const STATE_FILE_PATH = path.join(process.cwd(), 'logs', 'playback-state.json');

/**
 * 현재 각 서버의 음악 재생 상태를 파일에 동기식으로 보존합니다.
 * 재생 상태가 없으면 기존 백업 파일을 즉시 삭제합니다.
 */
export function savePlaybackStatesSync(guildStates: Map<string, GuildState>): void {
  const statesToSave: PersistedGuildState[] = [];

  for (const [guildId, state] of guildStates.entries()) {
    // 음성 채널이 없거나, 현재 재생 중이 아니면서 큐도 비어있으면 저장 대상에서 제외
    if (!state.voiceChannelId || (!state.current && state.queue.length === 0)) {
      continue;
    }

    let currentPosition = 0;
    if (state.playing && state.trackStartedAt) {
      currentPosition = (state.accumulatedPosition || 0) + (Date.now() - state.trackStartedAt);
    } else if (state.player && typeof state.player.position === 'number') {
      currentPosition = state.player.position || 0;
    }

    statesToSave.push({
      guildId,
      voiceChannelId: state.voiceChannelId,
      textChannelId: state.textChannelId,
      current: state.current,
      position: currentPosition,
      queue: state.queue,
      history: state.history.slice(-10),
      loop: state.loop,
      auto: state.auto,
      autoMood: state.autoMood,
    });
  }

  if (statesToSave.length === 0) {
    // 재생 중인 곡/큐가 없으면 저장 파일 즉시 삭제
    clearPlaybackStateSync();
    return;
  }

  try {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    fsSync.writeFileSync(STATE_FILE_PATH, JSON.stringify(statesToSave, null, 2), 'utf-8');
    logger.info('music', `[StateStore] Sync saved ${statesToSave.length} guild state(s) to ${STATE_FILE_PATH}`);
  } catch (err: any) {
    logger.error('music', `[StateStore] Failed sync save playback states: ${err.message}`, { error: err });
  }
}

/**
 * 저장된 재생 상태 파일을 읽어옵니다.
 */
export function loadPlaybackStates(): PersistedGuildState[] {
  try {
    if (!fsSync.existsSync(STATE_FILE_PATH)) {
      return [];
    }
    const data = fsSync.readFileSync(STATE_FILE_PATH, 'utf-8');
    const states: PersistedGuildState[] = JSON.parse(data);
    logger.info('music', `[StateStore] Loaded ${states.length} guild state(s) from backup file.`);
    return states;
  } catch (err: any) {
    logger.warn('music', `[StateStore] Error reading playback state file: ${err.message}`);
    return [];
  }
}

/**
 * 백업 파일을 삭제합니다.
 */
export function clearPlaybackStateSync(): void {
  try {
    if (fsSync.existsSync(STATE_FILE_PATH)) {
      fsSync.unlinkSync(STATE_FILE_PATH);
      logger.info('music', '[StateStore] Playback state file cleared.');
    }
  } catch (err: any) {
    logger.warn('music', `[StateStore] Failed to clear playback state file: ${err.message}`);
  }
}
