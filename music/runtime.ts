import { 
  MusicRuntime, 
  RuntimeUtils, 
  Track, 
  PlaylistEntry, 
  HistoryEntry, 
  GuildState,
} from './types';
import { RuntimeResponse } from '../types';
import { findHistoryByRequester } from './repositorys/music-history.repository';
import { 
  insertPlaylist, 
  findPlaylist, 
  clearPlaylist, 
  updatePlaylist, 
  deletePlaylist 
} from './repositorys/playlist.repository';
import { notifyMusicUpdate } from '../common/socket';

export function createMusicRuntime({ 
  guildStates, 
  runtimeUtils 
}: { 
  guildStates: Map<string, GuildState>, 
  runtimeUtils: RuntimeUtils 
}): MusicRuntime {

  const {
    waitForReadyNode,
    joinOrMovePlayer,
    resolveTracks,
    getCurrentTrackForGuild,
    playNext,
  } = runtimeUtils;

  async function play(context: any, query: string | string[]): Promise<RuntimeResponse> {
    const { channelId, guild, member: contextMember, author, user } = context;
    if (!guild) throw new Error('Guild only command');

    const userId = user?.id || author?.id;
    if (!userId) throw new Error('User not found in context');

    const member = contextMember || await guild.members.fetch(userId);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return { ok: false, message: '음성채널에 먼저 입장해주세요!' };
    }

    const readyNode = await waitForReadyNode();
    if (!readyNode) {
      return {
        ok: false,
        message: '아직 서버가 준비 중이에요. 잠시 후에 다시 시도해주세요.',
      };
    }

    const rawQueries = Array.isArray(query) ? query : [query];
    const queries = rawQueries
      .flatMap(q => (typeof q === 'string' ? q.split(',') : q))
      .map(q => (typeof q === 'string' ? q.trim() : q))
      .filter(Boolean);
    
    const BATCH_SIZE = 25;
    const resolvedBatches = [];
    
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (q) => {
          const trimmed = (q || '').trim();
          if (!trimmed) return null;
          try {
            return await resolveTracks(trimmed);
          } catch (e) {
            console.error(`Resolve failed for ${trimmed}:`, e);
            return null;
          }
        })
      );
      resolvedBatches.push(...batchResults);
    }

    const state = await joinOrMovePlayer(guild, channelId, voiceChannel);

    let addedCount = 0;
    let firstTrackTitle = '';

    for (const res of resolvedBatches) {
      if (!res || !res.tracks.length) continue;

      const { tracks, playlistName } = res;
      if (playlistName) {
        const requestedTracks = tracks.map((track) => ({
          ...track,
          requestedBy: userId,
        }));
        state.queue.push(...requestedTracks);
        addedCount += requestedTracks.length;
        if (!firstTrackTitle) firstTrackTitle = playlistName;
      } else {
        const first = { ...tracks[0], requestedBy: userId };
        state.queue.push(first);
        addedCount += 1;
        if (!firstTrackTitle) firstTrackTitle = first.info?.title;
      }
    }

    if (addedCount === 0) {
      try {
        const res = await findPlaylist(userId);
        const playlist = res.map((music) => music.musicInfo);
        if (!playlist.length) {
          return { ok: false, message: 'Playlist가 비어있습니다! 추가 이후 재시도 해주세요!' };
        }

        const queuedTracks = playlist.map((track) => ({
          encoded: track.encoded,
          info: track.info || {},
          requestedBy: userId,
        }));

        state.queue.push(...queuedTracks);
        notifyMusicUpdate(guild.id, 'queue');
        await playNext(guild.id);
        return { ok: true, message: `총 ${queuedTracks.length} 개의 노래를 추가 했어요!` };
      }
      catch (err) {
        console.error(err);
        return { ok: false, message: '찾을 수 없는 노래에요!' };
      }
    }

    if (!state.playing) {
      await playNext(guild.id);
    }

    notifyMusicUpdate(guild.id, 'queue');

    if (addedCount > 1) {
      return { ok: true, message: `**${firstTrackTitle}** 외 ${addedCount - 1}곡을 추가했어요!` };
    }
    return { ok: true, message: `**${firstTrackTitle || 'Unknown title'}**을(를) 추가했어요!` };
  }

  async function skip(guildId: string): Promise<RuntimeResponse> {
    const state = guildStates.get(guildId);
    if (!state || !state.player || !state.playing) {
      return { ok: false, message: '아무것도 재생 중이지 않아요!' };
    }

    await state.player.stopTrack();
    return { ok: true, message: '현재 노래를 넘겼어요!' };
  }

  async function stop(guildId: string): Promise<RuntimeResponse> {
    const state = guildStates.get(guildId);
    if (!state || !state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    await (runtimeUtils as any).stopShoukaku(guildId);

    return { ok: true, message: '모든 노래를 중지했어요!' };
  }

  function queue(guildId: string) {
    const state = guildStates.get(guildId);
    if (!state || (!state.current && state.queue.length === 0)) {
      return { message: 'Queue가 비어있어요!', count: 0 };
    }

    const currentLine = state.current
      ? `현재 곡\n - **${state.current.info?.title || 'Unknown title'}**`
      : '현재 곡\n nothing';
    const upcoming = state.queue
      .slice(0, 10)
      .map((track, index) => `${index + 1}. ${track.info?.title || 'Unknown title'}`)
      .join('\n');

    return { message: `${currentLine}\n\n대기 중인 곡\n**${upcoming || 'none'}**`, count: state.queue.length + 1 };
  }

  async function getPlaylist(userId: string): Promise<Track[]> {
    const res: PlaylistEntry[] = await findPlaylist(userId);
    const playlist: Track[] = res.map((music: PlaylistEntry) => music.musicInfo);
    return playlist;
  }

  async function addToPlaylist(guildId: string, userId: string, query: string): Promise<RuntimeResponse> {
    const trimmedQuery = (query || '').trim();
    let track: Track | null = null;
    let note = '';

    if (!trimmedQuery) {
      track = await getCurrentTrackForGuild(guildId);
      if (!track) {
        return { ok: false, message: '재생중인 노래가 없어요!' };
      }
    }
    else {
      const { tracks, playlistName } = await resolveTracks(trimmedQuery);
      if (!tracks.length) {
        return { ok: false, message: '노래를 찾을 수 없어요' };
      }
      track = tracks[0];
      if (playlistName && tracks.length > 1) {
        note = `\n재생중인 노래를 추가했어요!: **${playlistName}**`;
      }
    }

    await insertPlaylist(userId, track);
    notifyMusicUpdate(userId, 'playlist');

    const title = track.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에 노래를 추가했어요!\n **${title}**${note}` };
  }

  async function clearToPlaylist(userId: string): Promise<RuntimeResponse> {
    const cleared = await clearPlaylist(userId);
    if (!cleared) {
      return { ok: true, message: 'Playlist가 이미 비어있어요!' };
    }
    return { ok: true, message: `총 ${cleared}개의 항목을 비웠어요!` };
  }

  async function deleteFromPlaylist(userId: string, index: number | string): Promise<RuntimeResponse> {
    const entries = await findPlaylist(userId);
    if (!entries.length) {
      return { ok: false, message: 'Playlist가 비어있어요' };
    }

    const targetIndex = Number(index);
    if (!Number.isInteger(targetIndex) || targetIndex < 1 || targetIndex > entries.length) {
      return { ok: false, message: `번호가 잘못됐어요. 1 ~ ${entries.length} 번을 입력해주세요.` };
    }

    const entry = entries[targetIndex - 1];
    await deletePlaylist(userId, entry.id);
    notifyMusicUpdate(userId, 'playlist');
    const title = entry.musicInfo?.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에서 노래를 삭제했어요!\n **${title}**` };
  }

  function getQueueSnapshot(guildId: string) {
    const state = guildStates.get(guildId);
    return {
      current: state?.current || null,
      queue: state?.queue.slice() || [],
    };
  }

  function moveQueueItem(guildId: string, fromIndex: number | string, toIndex: number | string): RuntimeResponse {
    const state = guildStates.get(guildId);
    if (!state) return { ok: false, message: '재생 중인 서버가 아니에요.' };
    
    const length = state.queue.length;
    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > length || to > length) {
      return { ok: false, message: `유효하지 않은 위치예요. 1-${length}번을 선택해주세요.` };
    }

    if (from === to) {
      return { ok: true, message: '같은 위치예요.' };
    }

    const [item] = state.queue.splice(from - 1, 1);
    state.queue.splice(to - 1, 0, item);
    notifyMusicUpdate(guildId, 'queue');
    const title = item?.info?.title || 'Unknown title';
    return { ok: true, message: `Moved: ${title} (${from} -> ${to})` };
  }

  function removeQueueItem(guildId: string, index: number | string): RuntimeResponse {
    const state = guildStates.get(guildId);
    if (!state) return { ok: false, message: '재생 중인 서버가 아니에요.' };
    
    const length = state.queue.length;
    const target = Number(index);

    if (!Number.isInteger(target) || target < 1 || target > length) {
      return { ok: false, message: `유효하지 않은 위치예요. 1-${length}번을 선택해주세요.` };
    }

    const [removed] = state.queue.splice(target - 1, 1);
    notifyMusicUpdate(guildId, 'queue');
    const title = removed?.info?.title || 'Unknown title';
    return { ok: true, message: `Removed: ${title}` };
  }

  async function history(guildId: string, requestedBy?: string): Promise<{ total: number; items: HistoryEntry[] }> {
    const items = await findHistoryByRequester(guildId, requestedBy);

    return {
      total: items.length,
      items: items,
    };
  }

  async function searchTracks(query: string) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
      return { tracks: [], playlistName: null };
    }
    return resolveTracks(trimmedQuery);
  }

  async function loop(guildId: string, enable: boolean | null): Promise<{ enabled: boolean }> {
    const state = guildStates.get(guildId);
    if (!state) return { enabled: false };
    state.loop = (enable !== null) ? Boolean(enable) : !state.loop;
    return { enabled: Boolean(state.loop) };
  }

  async function movePlaylistItem(userId: string, fromIndex: number | string, toIndex: number | string): Promise<RuntimeResponse> {
    const entries = await findPlaylist(userId);
    if (!entries.length) {
      return { ok: false, message: 'Playlist가 비어있어요' };
    }

    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > entries.length || to > entries.length) {
      return { ok: false, message: `번호가 잘못됐어요. 1 ~ ${entries.length} 번을 입력해주세요.` };
    }

    if (from === to) {
      return { ok: true, message: '노래 위치가 이미 같아요' };
    }

    const moved = entries.slice();
    const [item] = moved.splice(from - 1, 1);
    moved.splice(to - 1, 0, item);

    const start = Math.min(from, to) - 1;
    const end = Math.max(from, to) - 1;

    const sequelize = (entries[0] as any).sequelize || (entries[0] as any).constructor?.sequelize;
    const transaction = sequelize ? await sequelize.transaction() : null;
    try {
      for (let i = start; i <= end; i += 1) {
        const entry = entries[i];
        await updatePlaylist(userId, entry.id, moved[i].musicInfo, transaction || undefined);
      }
      if (transaction) {
        await transaction.commit();
      }
      notifyMusicUpdate(userId, 'playlist');
    }
    catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      throw error;
    }

    const title = item.musicInfo?.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에서 노래 위치를 이동했어요!\n **${title}** (${from} -> ${to})` };
  }

  async function pause(guildId: string): Promise<RuntimeResponse> {
    const state = guildStates.get(guildId);
    if (!state || !state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    const isPaused = !state.player.paused;
    state.player.setPaused(isPaused);
    state.playing = !isPaused;
    
    notifyMusicUpdate(guildId);
    
    return { ok: true, message: isPaused ? '노래를 일시정지했어요!' : '노래를 다시 재생할게요!' };
  }

  async function previous(guildId: string): Promise<RuntimeResponse> {
    const state = guildStates.get(guildId);
    if (!state || !state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    const prevTrack = state.history.pop();
    if (!prevTrack) {
      return { ok: false, message: '이전 세션에 재생된 곡이 없어요.' };
    }

    console.log(state.history);
    if (state.current) {
      state.queue.unshift(state.current);
    }

    state.queue.unshift(prevTrack);

    if (!state.current) {
        state.playing = false;
        await playNext(guildId);
        return { ok: true, message: `이전 곡을 재생합니다: **${prevTrack.info.title}**` };
    }

    state.current = null;
    state.playing = false;

    await state.player.stopTrack();

    return { ok: true, message: `이전 곡을 재생합니다: **${prevTrack.info.title}**` };
  }

  return {
    play,
    skip,
    stop,
    queue,
    loop,
    history,
    searchTracks,
    getPlaylist,
    addToPlaylist,
    clearToPlaylist,
    getQueueSnapshot,
    moveQueueItem,
    removeQueueItem,
    deleteFromPlaylist,
    movePlaylistItem,
    pause,
    previous
  };
}
