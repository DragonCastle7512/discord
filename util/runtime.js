function createMusicRuntime({ client, shoukaku, readyNodes, allowSoundCloudFallback, lavalinkReadyTimeoutMs }) {
  const guildStates = new Map();
  const userPlaylists = new Map();

  function isUrl(input) {
    return /^https?:\/\//i.test(input);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractYoutubeVideoId(input) {
    try {
      const u = new URL(input);
      const host = u.hostname.toLowerCase();

      if (host.includes('youtube.com')) {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
        if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
      }

      if (host === 'youtu.be') return u.pathname.replace('/', '') || null;
    }
    catch (err) {
        console.log(err);
    }

    return null;
  }

  function getGuildState(guildId) {
    if (!guildStates.has(guildId)) {
      guildStates.set(guildId, {
        player: null,
        queue: [],
        current: null,
        textChannelId: null,
        voiceChannelId: null,
        playing: false,
      });
    }

    return guildStates.get(guildId);
  }

  function getTextChannel(textChannelId) {
    if (!textChannelId) return null;
    return client.channels.cache.get(textChannelId) || null;
  }

  async function waitForReadyNode(timeoutMs = lavalinkReadyTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (readyNodes.size > 0) {
        const [name] = readyNodes;
        return shoukaku.nodes.get(name) || [...shoukaku.nodes.values()][0] || null;
      }
      await sleep(250);
    }
    return null;
  }

  async function joinOrMovePlayer(guild, textChannelId, voiceChannel) {
    const state = getGuildState(guild.id);
    state.textChannelId = textChannelId;

    if (state.player && state.voiceChannelId === voiceChannel.id) {
        return state;
    }

    if (state.player && state.voiceChannelId !== voiceChannel.id) {
        try {
            await shoukaku.leaveVoiceChannel(guild.id);
        }
        catch (err) {
            console.log(err);
        }

        state.player = null;
        state.voiceChannelId = null;
        state.playing = false;
        state.current = null;
    }

    if (!state.player) {
      try {
        await shoukaku.leaveVoiceChannel(guild.id);
      }
      catch (err) {
        console.error(err);
      }

      let player;
      try {
        player = await shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true,
        });
      }
      catch (err) {
        if (!String(err?.message || '').includes('already have an existing connection')) {
          throw err;
        }
        try {
          await shoukaku.leaveVoiceChannel(guild.id);
        }
        catch {
          console.log('leave 실패');
        }

        // leave 이후 재접속 시도
        player = await shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true,
        });
      }

      player.on('end', async () => {
        state.playing = false;
        state.current = null;
        await playNext(guild.id);
      });

      player.on('exception', async (event) => {
        console.error('Player exception:', event);
        state.playing = false;
        state.current = null;
        const textChannel = getTextChannel(state.textChannelId);
        if (textChannel) {
          textChannel.send('Track failed. Skipping to next.').catch((err) => console.error(err));
        }
        await playNext(guild.id);
      });

      player.on('stuck', async () => {
        state.playing = false;
        state.current = null;
        const textChannel = getTextChannel(state.textChannelId);
        if (textChannel) {
          textChannel.send('Track got stuck. Skipping to next.').catch((err) => console.log(err));
        }
        await playNext(guild.id);
      });

      player.on('closed', () => {
        state.player = null;
        state.playing = false;
        state.current = null;
      });

      state.player = player;
      state.voiceChannelId = voiceChannel.id;
    }

    return state;
  }

  async function resolveTracks(query) {
    const node =
      (readyNodes.has('main') && shoukaku.nodes.get('main')) ||
      [...readyNodes].map((name) => shoukaku.nodes.get(name)).find(Boolean) ||
      null;
    if (!node) throw new Error('No Lavalink node is available');

    const isDirectUrl = isUrl(query);
    const ytId = isDirectUrl ? extractYoutubeVideoId(query) : null;

    const identifiers = [];
    if (isDirectUrl) {
      identifiers.push(query);
      if (ytId) {
        identifiers.push(`https://www.youtube.com/watch?v=${ytId}`);
        identifiers.push(`https://music.youtube.com/watch?v=${ytId}`);
        identifiers.push(`https://youtu.be/${ytId}`);
        identifiers.push(`ytsearch:${ytId}`);
        identifiers.push(`ytmsearch:${ytId}`);
      }
    }
    else {
      identifiers.push(`ytmsearch:${query}`, `ytsearch:${query}`);
      if (allowSoundCloudFallback) {
        identifiers.push(`scsearch:${query}`);
      }
    }

    const errors = [];

    for (const identifier of identifiers) {
      let result;
      try {
        result = await node.rest.resolve(identifier);
      }
      catch (error) {
        errors.push(`${identifier}: ${error.message || 'request failed'}`);
        continue;
      }

      if (!result || result.loadType === 'empty') continue;

      if (result.loadType === 'playlist') {
        return {
          tracks: result.data?.tracks || [],
          playlistName: result.data?.info?.name || 'Playlist',
        };
      }

      if (result.loadType === 'track') {
        return { tracks: result.data ? [result.data] : [], playlistName: null };
      }

      if (result.loadType === 'search') {
        const tracks = Array.isArray(result.data) ? result.data : [];
        if (tracks.length) return { tracks, playlistName: null };
        continue;
      }

      if (result.loadType === 'error') {
        const detail = result.data?.message || result.data?.cause || 'unknown';
        errors.push(`${identifier}: ${detail}`);
      }
    }

    if (errors.length) {
      throw new Error(`Track lookup failed (${errors.join(' | ')})`);
    }

    return { tracks: [], playlistName: null };
  }

  async function playNext(guildId) {
    const state = guildStates.get(guildId);
    if (!state || !state.player || state.playing) return;

    const next = state.queue.shift();
    if (!next) {
      state.current = null;
      return;
    }

    state.current = next;
    state.playing = true;

    await state.player.playTrack({ track: { encoded: next.encoded } });

    const textChannel = getTextChannel(state.textChannelId);
    if (textChannel) {
      const title = next.info?.title || 'Unknown title';
      const uri = next.info?.uri || '';
      textChannel.send(`재생 중... **${title}**${uri ? `\n${uri}` : ''}`).catch((err) => console.error(err));
    }
  }

  async function play(interaction, query) {
    const guild = interaction.guild;
    if (!guild) throw new Error('Guild only command');
    const trimmedQuery = (query || '').trim();

    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return { ok: false, message: '음성채널에 먼저 입장해주세요!' };
    }

    const readyNode = await waitForReadyNode();
    if (!readyNode) {
      return {
        ok: false,
        message: 'Lavalink is not ready yet. Check `docker compose logs -f lavalink` and retry in a few seconds.',
      };
    }

    const state = await joinOrMovePlayer(guild, interaction.channelId, voiceChannel);
    if (!trimmedQuery) {
      const playlist = getUserPlaylist(interaction.user.id);
      if (!playlist.length) {
        return { ok: false, message: 'Playlist가 비어있습니다! 추가 이후 재시도 해주세요!' };
      }

      const queuedTracks = playlist.map((track) => ({
        encoded: track.encoded,
        info: track.info || {},
      }));

      state.queue.push(...queuedTracks);
      await playNext(guild.id);
      return { ok: true, message: `총 ${queuedTracks.length} 개의 노래를 추가 했어요!` };
    }

    const { tracks, playlistName } = await resolveTracks(trimmedQuery);

    if (!tracks.length) return { ok: false, message: '찾을 수 없는 노래에요!' };

    if (playlistName) {
      state.queue.push(...tracks);
      await playNext(guild.id);
      return { ok: true, message: `Playlist에 추가했어요 : **${playlistName}** (${tracks.length} tracks)` };
    }

    const first = tracks[0];
    state.queue.push(first);
    await playNext(guild.id);
    return { ok: true, message: `Queued: **${first.info?.title || 'Unknown title'}**` };
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

    state.queue = [];
    state.current = null;
    state.playing = false;
    await shoukaku.leaveVoiceChannel(guildId);
    state.player = null;
    state.voiceChannelId = null;

    return { ok: true, message: '모든 노래를 중지했어요!' };
  }

  function queue(guildId) {
    const state = guildStates.get(guildId);
    if (!state || (!state.current && state.queue.length === 0)) {
      return { ok: false, message: 'Queue가 비어있어요!' };
    }

    const currentLine = state.current
      ? `Now: **${state.current.info?.title || 'Unknown title'}**`
      : 'Now: nothing';
    const upcoming = state.queue
      .slice(0, 10)
      .map((track, index) => `${index + 1}. ${track.info?.title || 'Unknown title'}`)
      .join('\n');

    return { ok: true, message: `${currentLine}\n\nUp next:\n${upcoming || 'none'}` };
  }

  async function playTts(interaction, query, input) {
    const guild = interaction.guild;
    if (!guild) throw new Error('Guild only command');

    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return { ok: false, message: '먼저 음성채널에 입장해주세요!' };
    }

    const state = await joinOrMovePlayer(guild, interaction.channelId, voiceChannel);
    if (state.playing) {
      return { ok: false, message: '이미 재생중인 음성이 있어요' };
    }

    const { tracks } = await resolveTracks(query);
    if (!tracks.length) return { ok: false, message: 'No matches found.' };

    const first = tracks[0];
    state.playing = true;
    state.current = null;
    await state.player.playTrack({ track: { encoded: first.encoded } });

    return { ok: true, message: `치사가 읽어드려요: "${input}"` };
  }

  function getUserPlaylist(userId) {
    if (!userPlaylists.has(userId)) {
      userPlaylists.set(userId, []);
    }
    return userPlaylists.get(userId);
  }

  async function getPlaylist(userId) {
    const playlist = getUserPlaylist(userId);
    if (!playlist.length) {
      return { ok: false, message: 'Playlist가 비어있어요' };
    }

    const lines = playlist.slice(0, 20).map((track, index) => {
      const title = track.info?.title || 'Unknown title';
      return `${index + 1}. ${title}`;
    });
    return { ok: true, message: lines.join('\n') };
  }

  async function getCurrentTrackForGuild(guildId) {
    const state = guildStates.get(guildId);
    if (state?.current) {
      return state.current;
    }

    const player = state?.player || shoukaku?.players?.get(guildId) || null;
    const encoded = player?.track || null;
    if (!encoded) {
      return null;
    }

    try {
      const decoded = await player.node.rest.decode(encoded);
      if (!decoded?.encoded) {
        return null;
      }

      const track = {
        encoded: decoded.encoded,
        info: decoded.info || {},
      };

      if (state) {
        state.current = track;
      }

      return track;
    }
    catch {
      return null;
    }
  }

  async function addToPlaylist(guildId, userId, query) {
    const playlist = getUserPlaylist(userId);
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

    playlist.push({
      encoded: track.encoded,
      info: track.info || {},
      addedAt: Date.now(),
    });

    const title = track.info?.title || 'Unknown title';
    return { ok: true, message: `Playlist에 노래를 추가했어요!\n **${title}**${note}` };
  }

  return {
    play,
    skip,
    stop,
    queue,
    playTts,
    getPlaylist,
    addToPlaylist,
  };
}

module.exports = { createMusicRuntime };
