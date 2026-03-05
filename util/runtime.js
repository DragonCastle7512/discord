const { PermissionsBitField } = require('discord.js');

function createMusicRuntime({ client, shoukaku, readyNodes, allowSoundCloudFallback, lavalinkReadyTimeoutMs }) {
  const guildStates = new Map();

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

  function ensureVoicePermissions(member, channel) {
    const me = member.guild.members.me;
    if (!me) return false;

    const perms = channel.permissionsFor(me);
    if (!perms) return false;

    return (
      perms.has(PermissionsBitField.Flags.ViewChannel) &&
      perms.has(PermissionsBitField.Flags.Connect) &&
      perms.has(PermissionsBitField.Flags.Speak)
    );
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
        state.playing = false;
        state.current = null;
    }

    if (!state.player) {
      const player = await shoukaku.joinVoiceChannel({
        guildId: guild.id,
        channelId: voiceChannel.id,
        shardId: guild.shardId,
        deaf: true,
      });

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
      textChannel.send(`Now playing: **${title}**${uri ? `\n${uri}` : ''}`).catch((err) => console.error(err));
    }
  }

  async function play(interaction, query) {
    const guild = interaction.guild;
    if (!guild) throw new Error('Guild only command');

    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return { ok: false, message: 'Join a voice channel first.' };
    }

    if (!ensureVoicePermissions(member, voiceChannel)) {
      return {
        ok: false,
        message: 'Bot needs ViewChannel, Connect, and Speak permissions in that voice channel.',
      };
    }

    const readyNode = await waitForReadyNode();
    if (!readyNode) {
      return {
        ok: false,
        message: 'Lavalink is not ready yet. Check `docker compose logs -f lavalink` and retry in a few seconds.',
      };
    }

    const state = await joinOrMovePlayer(guild, interaction.channelId, voiceChannel);
    const { tracks, playlistName } = await resolveTracks(query);

    if (!tracks.length) return { ok: false, message: 'No matches found.' };

    if (playlistName) {
      state.queue.push(...tracks);
      await playNext(guild.id);
      return { ok: true, message: `Playlist queued: **${playlistName}** (${tracks.length} tracks)` };
    }

    const first = tracks[0];
    state.queue.push(first);
    await playNext(guild.id);
    return { ok: true, message: `Queued: **${first.info?.title || 'Unknown title'}**` };
  }

  async function skip(guildId) {
    const state = guildStates.get(guildId);
    if (!state || !state.player || !state.playing) {
      return { ok: false, message: 'Nothing is currently playing.' };
    }

    await state.player.stopTrack();
    return { ok: true, message: 'Skipped current track.' };
  }

  async function stop(guildId) {
    const state = guildStates.get(guildId);
    if (!state || !state.player) {
      return { ok: false, message: 'Nothing to stop.' };
    }

    state.queue = [];
    state.current = null;
    state.playing = false;
    await shoukaku.leaveVoiceChannel(guildId);
    state.player = null;
    state.voiceChannelId = null;

    return { ok: true, message: 'Stopped playback and left the channel.' };
  }

  function queue(guildId) {
    const state = guildStates.get(guildId);
    if (!state || (!state.current && state.queue.length === 0)) {
      return { ok: false, message: 'Queue is empty.' };
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

  return {
    play,
    skip,
    stop,
    queue,
  };
}

module.exports = { createMusicRuntime };
