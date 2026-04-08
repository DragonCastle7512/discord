const { findHistoryByRequester } = require('./repositorys/music-history.repository');
const { insertPlaylist, findPlaylist, clearPlaylist, updatePlaylist, deletePlaylist } = require('./repositorys/playlist.repository');

function createMusicRuntime({ guildStates, runtimeUtils }) {

  const {
    waitForReadyNode,
    joinOrMovePlayer,
    resolveTracks,
    getCurrentTrackForGuild,
    playNext,
  } = runtimeUtils;

  /* interaction과 message객체 모두 호환 */
  async function play(context, query) {
    const { channelId } = context;
    const guild = context.guild || client.guilds.cache.get(message.guildId);
    if (!guild) throw new Error('Guild only command');
    const trimmedQuery = (query || '').trim();

    const userId = context.user?.id || context.author?.id;
    const member = await guild.members.fetch(userId);
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

    const state = await joinOrMovePlayer(guild, channelId, voiceChannel);
    if (!trimmedQuery) {
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
      await playNext(guild.id);
      return { ok: true, message: `총 ${queuedTracks.length} 개의 노래를 추가 했어요!` };
    }

    const { tracks, playlistName } = await resolveTracks(trimmedQuery);

    if (!tracks.length) return { ok: false, message: '찾을 수 없는 노래에요!' };

    if (playlistName) {
      const requestedTracks = tracks.map((track) => ({
        ...track,
        requestedBy: userId,
      }));
      state.queue.push(...requestedTracks);
      await playNext(guild.id);
      return { ok: true, message: `Playlist에 추가했어요 : **${playlistName}** (${tracks.length} tracks)` };
    }

    const first = { ...tracks[0], requestedBy: userId };
    state.queue.push(first);
    await playNext(guild.id);
    return { ok: true, message: `**${first.info?.title || 'Unknown title'}**을(를) 추가했어요!` };
  }

  async function skip(guildId) {
    const state = guildStates.get(guildId);
    if (!state || !state.player || !state.playing) {
      return { ok: false, message: '아무것도 재생 중이지 않아요!' };
    }

    await state.player.stopTrack();
    return { ok: true, message: '현재 노래를 넘겼어요!' };
  }

  async function stop(guildId) {
    const state = guildStates.get(guildId);
    if (!state || !state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    await runtimeUtils.stopShoukaku(guildId);

    return { ok: true, message: '모든 노래를 중지했어요!' };
  }

  function queue(guildId) {
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

  async function getPlaylist(userId) {
    const res = await findPlaylist(userId);
    const playlist = res.map((music) => music.musicInfo);
    return playlist;
  }

  async function addToPlaylist(guildId, userId, query) {
    const trimmedQuery = (query || '').trim();
    let track = null;
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

    await insertPlaylist(userId, {
      encoded: track.encoded,
      info: track.info || {},
      addedAt: Date.now(),
    });

    const title = track.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에 노래를 추가했어요!\n **${title}**${note}` };
  }

  async function clearToPlaylist(userId) {
    const cleared = await clearPlaylist(userId);
    if (!cleared) {
      return { ok: true, message: 'Playlist가 이미 비어있어요!' };
    }
    return { ok: true, message: `총 ${cleared}개의 항목을 비웠어요!` };
  }

  async function deleteFromPlaylist(userId, index) {
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
    const title = entry.musicInfo?.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에서 노래를 삭제했어요!\n **${title}**` };
  }

  function getQueueSnapshot(guildId) {
    const state = guildStates.get(guildId);
    return {
      current: state?.current || null,
      queue: state?.queue.slice() || [],
    };
  }

  function moveQueueItem(guildId, fromIndex, toIndex) {
    const state = guildStates.get(guildId);
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
    const title = item?.info?.title || 'Unknown title';
    return { ok: true, message: `Moved: ${title} (${from} -> ${to})` };
  }

  function removeQueueItem(guildId, index) {
    const state = guildStates.get(guildId);
    const length = state.queue.length;
    const target = Number(index);

    if (!Number.isInteger(target) || target < 1 || target > length) {
      return { ok: false, message: `유효하지 않은 위치예요. 1-${length}번을 선택해주세요.` };
    }

    const [removed] = state.queue.splice(target - 1, 1);
    const title = removed?.info?.title || 'Unknown title';
    return { ok: true, message: `Removed: ${title}` };
  }

  async function history(guildId, requestedBy) {
    const items = await findHistoryByRequester(guildId, requestedBy);

    return {
      total: items.length,
      items: items,
    };
  }

  async function searchTracks(query) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
      return { tracks: [], playlistName: null };
    }
    return resolveTracks(trimmedQuery);
  }

  async function loop(guildId, enable) {
    const state = guildStates.get(guildId);
    state.loop = (enable !== null) ? Boolean(enable) : !state.loop;
    return { enabled: Boolean(state.loop) };
  }

  async function movePlaylistItem(userId, fromIndex, toIndex) {
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

    const original = entries.map((entry) => entry.musicInfo);
    const moved = original.slice();
    const [item] = moved.splice(from - 1, 1);
    moved.splice(to - 1, 0, item);

    const start = Math.min(from, to) - 1;
    const end = Math.max(from, to) - 1;

    const sequelize = entries[0].sequelize || entries[0].constructor?.sequelize;
    const transaction = sequelize ? await sequelize.transaction() : null;
    try {
      for (let i = start; i <= end; i += 1) {
        const entry = entries[i];
        await updatePlaylist(userId, entry.id, moved[i], transaction || undefined);
      }
      if (transaction) {
        await transaction.commit();
      }
    }
    catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      throw error;
    }

    const title = item?.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에서 노래 위치를 이동했어요!\n **${title}** (${from} -> ${to})` };
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
  };
}

module.exports = { createMusicRuntime };
