import { Client, Guild, VoiceBasedChannel, TextChannel } from 'discord.js';
import { Shoukaku, Player, Node } from 'shoukaku';
import { GuildState, Track, RuntimeUtils } from '../types';
import { isUrl, extractYoutubeVideoId, extractTagsFromTrackInfo, sleep } from '../utils/track-parser';
import { buildNowPlayingEmbed } from '../embeds/buildEmbed';
import { insertHistory, updateHistorySkipped } from '../repositorys/music-history.repository';
import { notifyMusicUpdate } from '../../common/socket';
import { createAutoplayService } from './autoplay.service';
import { logger } from '../../common/logger';

export interface PlayerEngineDeps {
  client: Client;
  shoukaku: Shoukaku;
  readyNodes: Set<string>;
  allowSoundCloudFallback: boolean;
  lavalinkReadyTimeoutMs: number;
  guildStates: Map<string, GuildState>;
}

/**
 * 물리 재생 엔진 레이어
 */
export function createPlayerEngine(deps: PlayerEngineDeps): RuntimeUtils {
  const {
    client,
    shoukaku,
    readyNodes,
    allowSoundCloudFallback,
    lavalinkReadyTimeoutMs,
    guildStates,
  } = deps;

  function getGuildState(guildId: string): GuildState {
    if (!guildStates.has(guildId)) {
      guildStates.set(guildId, {
        player: null,
        queue: [],
        history: [],
        current: null,
        textChannelId: null,
        voiceChannelId: null,
        playing: false,
        loop: false,
        auto: false,
        autoMood: null,
        autoPool: [],
      });
    }
    return guildStates.get(guildId)!;
  }

  function getTextChannel(textChannelId: string | null): TextChannel | null {
    if (!textChannelId) return null;
    return (client.channels.cache.get(textChannelId) as TextChannel) || null;
  }

  // Autoplay 서비스 연동
  const autoplayService = createAutoplayService({
    client,
    guildStates,
    resolveTracks,
    playNext,
    getTextChannel,
    notifyMusicUpdate,
  });

  async function joinOrMovePlayer(
    guild: Guild,
    textChannelId: string,
    voiceChannel: VoiceBasedChannel
  ): Promise<GuildState> {
    const state = getGuildState(guild.id);
    state.textChannelId = textChannelId;

    if (state.player && state.voiceChannelId === voiceChannel.id) {
      return state;
    }

    if (state.player && state.voiceChannelId !== voiceChannel.id) {
      try {
        await shoukaku.leaveVoiceChannel(guild.id);
      } catch (err) {
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
      } catch (err) {
        logger.error('music', `Voice channel leave failed during setup: ${err instanceof Error ? err.message : String(err)}`, { error: err });
      }

      let player: Player;
      try {
        player = await shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true,
        });
      } catch (err: any) {
        if (!String(err?.message || '').includes('already have an existing connection')) {
          throw err;
        }
        try {
          await shoukaku.leaveVoiceChannel(guild.id);
        } catch {
          console.log('leave 실패');
        }

        player = await shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true,
        });
      }

      player.on('end', async (event) => {
        if ((event?.reason as any) === 'replaced') {
          return;
        }
        const endedTrack = state.current;
        const endedHistoryId = state.currentHistoryId;
        state.playing = false;
        state.current = null;
        state.currentHistoryId = null;

        if (endedTrack && (event?.reason as any) !== 'replaced') {
          state.history.push(endedTrack);
          if (state.history.length > 50) {
            state.history.shift();
          }
        }

        if (endedHistoryId && event?.reason !== 'finished') {
          updateHistorySkipped(endedHistoryId, true).catch((err) =>
            logger.error('music', 'Failed to mark track as skipped in history db', { error: err })
          );
        }
        if (
          state.loop &&
          endedTrack &&
          (!event?.reason || event.reason === 'finished' || event.reason === 'stopped')
        ) {
          state.queue.push({
            ...endedTrack,
            info: endedTrack.info ? { ...endedTrack.info } : ({} as any),
          });
        }
        notifyMusicUpdate(guild.id, 'music');
        await playNext(guild.id);
      });

      player.on('exception', async (event) => {
        logger.error('music', `Player exception occurred while playing track: ${state.current?.info?.title || 'Unknown'}`, {
          guildId: guild.id,
          trackTitle: state.current?.info?.title || 'Unknown',
          trackUri: state.current?.info?.uri || '',
          exceptionMessage: event.exception?.message || 'No exception message',
          exceptionSeverity: event.exception?.severity || 'unknown',
        });
        state.playing = false;
        state.current = null;
        notifyMusicUpdate(guild.id, 'music');
        const textChannel = getTextChannel(state.textChannelId);
        if (textChannel) {
          textChannel.send('재생 도중에 오류가 발생했어요!').catch((err) => logger.error('music', 'Failed to send playback error notification', { error: err }));
        }
      });

      player.on('stuck', async (event) => {
        logger.warn('music', `Track got stuck: ${state.current?.info?.title || 'Unknown'}`, {
          guildId: guild.id,
          trackTitle: state.current?.info?.title || 'Unknown',
          trackUri: state.current?.info?.uri || '',
          thresholdMs: event?.thresholdMs || null,
        });
        state.playing = false;
        state.current = null;
        notifyMusicUpdate(guild.id, 'music');
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
        state.history = [];
        notifyMusicUpdate(guild.id, 'music');
      });

      state.player = player;
      state.voiceChannelId = voiceChannel.id;
    }

    return state;
  }

  async function waitForReadyNode(timeoutMs = lavalinkReadyTimeoutMs): Promise<Node | null> {
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

  async function resolveTracks(query: string): Promise<{ tracks: Track[]; playlistName: string | null }> {
    const node =
      (readyNodes.has('main') && shoukaku.nodes.get('main')) ||
      [...readyNodes].map((name) => shoukaku.nodes.get(name)).find(Boolean) ||
      null;
    if (!node) throw new Error('No Lavalink node is available');

    const isDirectUrl = isUrl(query);
    const ytId = isDirectUrl ? extractYoutubeVideoId(query) : null;

    const identifiers: string[] = [];
    if (isDirectUrl) {
      identifiers.push(query);
      if (ytId) {
        identifiers.push(`https://www.youtube.com/watch?v=${ytId}`);
        identifiers.push(`https://music.youtube.com/watch?v=${ytId}`);
        identifiers.push(`https://youtu.be/${ytId}`);
        identifiers.push(`ytsearch:${ytId}`);
        identifiers.push(`ytmsearch:${ytId}`);
      }
    } else {
      if (/^(ytmsearch|ytsearch|scsearch):/.test(query)) {
        identifiers.push(query);
      } else {
        identifiers.push(`ytmsearch:${query}`, `ytsearch:${query}`);
        if (allowSoundCloudFallback) {
          identifiers.push(`scsearch:${query}`);
        }
      }
    }

    const errors: string[] = [];

    for (const identifier of identifiers) {
      let result;
      try {
        result = await node.rest.resolve(identifier);
      } catch (error: any) {
        errors.push(`${identifier}: ${error.message || 'request failed'}`);
        continue;
      }

      if (!result || result.loadType === 'empty') continue;

      if (result.loadType === 'playlist') {
        return {
          tracks: (result.data?.tracks || []) as Track[],
          playlistName: result.data?.info?.name || 'Playlist',
        };
      }

      if (result.loadType === 'track') {
        return { tracks: result.data ? [result.data as Track] : [], playlistName: null };
      }

      if (result.loadType === 'search') {
        const tracks = Array.isArray(result.data) ? (result.data as Track[]) : [];
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

  async function stopShoukaku(guildId: string): Promise<void> {
    const state = guildStates.get(guildId);
    if (state) {
      state.queue = [];
      state.history = [];
      state.current = null;
      state.playing = false;
      state.auto = false;
      state.autoMood = null;
      state.autoPool = [];
      await shoukaku.leaveVoiceChannel(guildId);
      state.player = null;
      state.voiceChannelId = null;
      notifyMusicUpdate(guildId, 'music');
    }
  }

  async function playNext(guildId: string): Promise<void> {
    const state = guildStates.get(guildId);
    if (!state || !state.player || state.playing) return;

    const next = state.queue.shift();
    if (!next) {
      state.current = null;
      if (state.auto) {
        autoplayService.triggerAutoPlay(guildId).catch((err) => logger.error('music', 'Autoplay trigger failed', { error: err }));
      }
      return;
    }

    state.current = next;

    const historyItem = await insertHistory(guildId, {
      encoded: next.encoded,
      info: next.info || ({} as any),
      requestedBy: next.requestedBy || null,
      tags: extractTagsFromTrackInfo(next.info || {}),
    }).catch((err) => {
      logger.error('music', 'Failed to insert history', { error: err });
      return null;
    });

    if (historyItem) {
      state.currentHistoryId = historyItem.id;
    } else {
      state.currentHistoryId = null;
    }

    state.playing = true;
    notifyMusicUpdate(guildId, 'music');
    try {
      await state.player.playTrack({ track: { encoded: next.encoded } });
      
      const info = next.info || {};
      const title = info.title || 'Unknown title';
      const uri = info.uri || '';
      const requesterId = next.requestedBy || null;

      logger.info('music', `Started playing track: ${title}`, {
        guildId,
        trackTitle: title,
        trackUri: uri,
        requestedBy: requesterId,
        durationMs: info.length,
      });

      const textChannel = getTextChannel(state.textChannelId);
      if (textChannel) {
        const thumbnailUrl = info.artworkUrl || null;
        const embed = buildNowPlayingEmbed({
          title,
          uri,
          requesterId,
          durationMs: info.length,
          thumbnailUrl,
          footer: textChannel?.name || 'Music',
        });
        textChannel.send({ embeds: [embed] }).catch((err) => logger.error('music', 'Failed to send now playing embed', { error: err }));
      }
    } catch (error) {
      logger.error('music', 'PlayTrack failed', { error });
      state.playing = false;
      state.current = null;
      return;
    }
  }

  async function getCurrentTrackForGuild(guildId: string): Promise<Track | null> {
    const state = guildStates.get(guildId);
    if (state?.current) {
      return state.current;
    }

    const player = state?.player || shoukaku?.players?.get(guildId) || null;
    const encoded = player?.track || null;
    if (!player || !encoded) {
      return null;
    }

    try {
      const decoded = await player.node.rest.decode(encoded);
      if (!decoded?.encoded) {
        return null;
      }

      const track: Track = {
        encoded: decoded.encoded,
        info: decoded.info as any || {},
      };

      if (state) {
        state.current = track;
      }

      return track;
    } catch {
      return null;
    }
  }

  return {
    waitForReadyNode,
    joinOrMovePlayer,
    resolveTracks,
    getCurrentTrackForGuild,
    playNext,
    stopShoukaku,
  };
}
