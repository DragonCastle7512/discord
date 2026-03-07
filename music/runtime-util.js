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

function createRuntimeUtils({
  client,
  shoukaku,
  readyNodes,
  allowSoundCloudFallback,
  lavalinkReadyTimeoutMs,
  guildStates,
}) {
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

    function getUserPlaylist(userId) {
        if (!userPlaylists.has(userId)) {
            userPlaylists.set(userId, []);
        }
        return userPlaylists.get(userId);
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
    return {
        getUserPlaylist,
        waitForReadyNode,
        joinOrMovePlayer,
        resolveTracks,
        getCurrentTrackForGuild,
        playNext,
    };
}

module.exports = { createRuntimeUtils };