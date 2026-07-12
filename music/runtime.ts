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
import { logger } from '../common/logger';
import { MusicHistory } from './models/music-history';
import { KeywordBlacklist } from './models/keyword-blacklist';
import { UserKeywordBlacklist } from './models/user-keyword-blacklist';
import { KeywordPin } from './models/keyword-pin';
import { UserKeywordPin } from './models/user-keyword-pin';
import { GuildConfig } from './models/guild-config';
import { dedupeSimilarKeywords, buildHistoryTagKeywords, isValidTagKeyword, normalizeText, isKeywordMatched, keywordSimilarity } from './services/recommand-service';

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
    const { channelId: originalChannelId, guild, member: contextMember, author, user } = context;
    if (!guild) throw new Error('Guild only command');

    const userId = user?.id || author?.id;
    if (!userId) throw new Error('User not found in context');

    let channelId = originalChannelId;
    try {
      const config = await GuildConfig.findOne({ where: { guildId: guild.id } });
      if (config && config.musicChannelId) {
        channelId = config.musicChannelId;
      }
    } catch (err) {
      logger.error('music', 'Failed to fetch guild channel config', { error: err });
    }

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
            logger.error('music', `Resolve failed for ${trimmed}: ${e instanceof Error ? e.message : String(e)}`, { error: e });
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
        logger.error('music', `Failed to queue playlist: ${err instanceof Error ? err.message : String(err)}`, { error: err });
        return { ok: false, message: '찾을 수 없는 노래에요!' };
      }
    }

    if (!state.current) {
      await playNext(guild.id);
    }

    notifyMusicUpdate(guild.id, 'queue');

    if (addedCount > 1) {
      return { ok: true, message: `**${firstTrackTitle}** 외 ${addedCount - 1}곡을 추가했어요!` };
    }
    return { ok: true, message: `**${firstTrackTitle || 'Unknown title'}**을(를) 추가했어요!` };
  }

  async function skip(guildId: string): Promise<RuntimeResponse> {
    const state = getOrCreateState(guildId);
    if (!state.player || !state.playing) {
      return { ok: false, message: '아무것도 재생 중이지 않아요!' };
    }

    await state.player.stopTrack();
    return { ok: true, message: '현재 노래를 넘겼어요!' };
  }

  async function stop(guildId: string): Promise<RuntimeResponse> {
    const state = getOrCreateState(guildId);
    if (!state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    await (runtimeUtils as any).stopShoukaku(guildId);

    return { ok: true, message: '모든 노래를 중지했어요!' };
  }

  function queue(guildId: string) {
    const state = getOrCreateState(guildId);
    if (!state.current && state.queue.length === 0) {
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
    return { ok: true, message: `Playlist에 노래를 추가했어요!\n ${title}${note}` };
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
    const state = getOrCreateState(guildId);
    return {
      current: state.current || null,
      queue: state.queue.slice() || [],
    };
  }

  function moveQueueItem(guildId: string, fromIndex: number | string, toIndex: number | string): RuntimeResponse {
    const state = getOrCreateState(guildId);
    if (!state.player) return { ok: false, message: '재생 중인 서버가 아니에요.' };
    
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
    const state = getOrCreateState(guildId);
    if (!state.player) return { ok: false, message: '재생 중인 서버가 아니에요.' };
    
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

  function shuffleQueue(guildId: string): RuntimeResponse {
    const state = getOrCreateState(guildId);
    if (state.queue.length === 0) {
      return { ok: false, message: '대기열이 비어 있어요.' };
    }
    if (state.queue.length < 2) {
      return { ok: false, message: '대기열에 섞을 곡이 2곡 이상 필요해요.' };
    }

    for (let i = state.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    }

    notifyMusicUpdate(guildId, 'queue');
    return { ok: true, message: `대기열 ${state.queue.length}곡을 무작위로 섞었어요.` };
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

  function getOrCreateState(guildId: string): GuildState {
    let state = guildStates.get(guildId);
    if (!state) {
      state = {
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
      };
      guildStates.set(guildId, state);
    }
    return state;
  }

  async function loop(guildId: string, enable: boolean | null): Promise<{ enabled: boolean }> {
    const state = getOrCreateState(guildId);
    state.loop = (enable !== null) ? Boolean(enable) : !state.loop;
    return { enabled: Boolean(state.loop) };
  }

  async function auto(context: any, enable: boolean | null, mood: string | null = null): Promise<{ enabled: boolean; mood?: string | null; message?: string }> {
    const guildId = typeof context === 'string' ? context : context.guildId || context.guild?.id;
    const state = getOrCreateState(guildId);
    
    if (enable !== null) {
      state.auto = Boolean(enable);
    } else {
      state.auto = !state.auto;
    }
    
    const userId = context?.user?.id || context?.author?.id || context?.member?.user?.id || null;
    if (state.auto) {
      if (userId) {
        state.autoRequesterId = userId;
      }
      if (mood !== null) {
        if (state.autoMood !== mood) {
          state.autoMood = mood;
          state.autoPool = [];
        }
      }
    } else {
      state.autoMood = null;
      state.autoRequesterId = null;
      state.autoPool = [];
    }
    
    if (state.auto && !state.current && state.queue.length === 0 && !state.playing) {
      const member = context?.member || (context?.user ? await context.guild?.members.fetch(context.user.id).catch(() => null) : null);
      const voiceChannel = member?.voice?.channel;
      
      if (voiceChannel) {
        try {
          const readyNode = await waitForReadyNode();
          if (readyNode) {
            await joinOrMovePlayer(context.guild, context.channelId || state.textChannelId, voiceChannel);
            playNext(guildId).catch((err: Error) => logger.error('music', 'Autoplay trigger on enable failed', { error: err }));
          }
        } catch (err) {
          logger.error('music', `Auto join failed: ${err instanceof Error ? err.message : String(err)}`, { error: err });
        }
      } else if (state.player) {
        playNext(guildId).catch((err: Error) => logger.error('music', 'Autoplay trigger on enable failed', { error: err }));
      }
    }
    
    return { enabled: Boolean(state.auto), mood: state.autoMood };
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
    const state = getOrCreateState(guildId);
    if (!state.player) {
      return { ok: false, message: '재생 중인 노래가 없어요!' };
    }

    const isPaused = !state.player.paused;
    state.player.setPaused(isPaused);
    state.playing = !isPaused;
    
    notifyMusicUpdate(guildId);
    
    return { ok: true, message: isPaused ? '노래를 일시정지했어요!' : '노래를 다시 재생할게요!' };
  }

  async function previous(guildId: string): Promise<RuntimeResponse> {
    const state = getOrCreateState(guildId);
    if (!state.player) {
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

  async function getKeywords(guildId: string, userId: string, isPersonal: boolean): Promise<{
    ok: boolean;
    keywords: Array<{ tag: string; freq: number; isPinned: boolean }>;
    blacklist: string[];
    pinned: string[];
  }> {
    try {
      const histories = await MusicHistory.findAll({ where: { guildId } });
      const keywordMap = new Map<string, number>();

      const filteredHistories = isPersonal
        ? histories.filter(h => String((h.musicInfo as any)?.requestedBy || '') === String(userId))
        : histories;

      filteredHistories.forEach(h => {
        if ((h.musicInfo as any)?.isSkipped) return;

        const tags = (h.musicInfo as any)?.tags || [];
        tags.forEach((tag: string) => {
          const normalized = normalizeText(tag);
          if (isValidTagKeyword(normalized)) {
            keywordMap.set(normalized, (keywordMap.get(normalized) || 0) + 1);
          }
        });
      });

      const plainHistories = filteredHistories.map(h => h.get({ plain: true }));
      const tagKeywordsRaw = buildHistoryTagKeywords(plainHistories, 9999);
      const dedupedKeywordsList: string[] = dedupeSimilarKeywords(tagKeywordsRaw);

      let blacklistSet = new Set<string>();
      if (isPersonal) {
        const blacklistRecords = await UserKeywordBlacklist.findAll({ where: { userId } });
        blacklistSet = new Set(blacklistRecords.map(r => r.keyword.toLowerCase().trim()));
      } else {
        const blacklistRecords = await KeywordBlacklist.findAll({ where: { guildId } });
        blacklistSet = new Set(blacklistRecords.map(r => r.keyword.toLowerCase().trim()));
      }

      let pinnedSet = new Set<string>();
      if (isPersonal) {
        const pinRecords = await UserKeywordPin.findAll({ where: { userId } }).catch(() => []);
        pinnedSet = new Set(pinRecords.map(r => normalizeText(r.keyword)));
      } else {
        const pinRecords = await KeywordPin.findAll({ where: { guildId } }).catch(() => []);
        pinnedSet = new Set(pinRecords.map(r => normalizeText(r.keyword)));
      }

      logger.info('music', `[getKeywords] Fetching keywords for guild ${guildId}, user ${userId}, personal: ${isPersonal}`);
      logger.info('music', `[getKeywords] Raw Blacklist: ${Array.from(blacklistSet).join(', ')}`);
      logger.info('music', `[getKeywords] Raw Pinned: ${Array.from(pinnedSet).join(', ')}`);

      const initialKeywords = dedupedKeywordsList
        .filter(tag => !isKeywordMatched(tag, blacklistSet))
        .map(tag => ({ 
          tag, 
          freq: keywordMap.get(tag) || 0,
          isPinned: isKeywordMatched(tag, pinnedSet)
        }));

      const existingTags = new Set(initialKeywords.map(k => k.tag));
      const missingPinnedKeywords = Array.from(pinnedSet)
        .filter(pinTag => !isKeywordMatched(pinTag, blacklistSet))
        .filter(pinTag => !existingTags.has(pinTag))
        .map(pinTag => ({
          tag: pinTag,
          freq: 0,
          isPinned: true
        }));

      const keywords = [...initialKeywords, ...missingPinnedKeywords]
        .filter(item => item.freq > 0 || item.isPinned)
        .sort((a, b) => b.freq - a.freq || a.tag.localeCompare(b.tag));

      logger.info('music', `[getKeywords] Final Matched Keywords Count: ${keywords.length}`, { keywords });

      return {
        ok: true,
        keywords,
        blacklist: Array.from(blacklistSet),
        pinned: Array.from(pinnedSet)
      };
    } catch (err: any) {
      logger.error('music', 'Failed to get keywords in runtime', { error: err.stack });
      return { ok: false, keywords: [], blacklist: [], pinned: [] };
    }
  }

  async function getKeywordBlacklist(targetId: string, isPersonal: boolean): Promise<{ ok: boolean; keywords: string[] }> {
    try {
      if (isPersonal) {
        const records = await UserKeywordBlacklist.findAll({ where: { userId: targetId } });
        return { ok: true, keywords: records.map(r => r.keyword) };
      } else {
        const records = await KeywordBlacklist.findAll({ where: { guildId: targetId } });
        return { ok: true, keywords: records.map(r => r.keyword) };
      }
    } catch (err: any) {
      logger.error('music', `Failed to get keyword blacklist for ${targetId}`, { error: err.stack });
      return { ok: false, keywords: [] };
    }
  }

  async function resolveSimilarKeyword(guildId: string, inputKeyword: string): Promise<string> {
    const normalizedInput = (inputKeyword || '').toLowerCase().trim();
    if (!normalizedInput) return normalizedInput;

    try {
      const histories = await MusicHistory.findAll({ where: { guildId } });
      const tagKeywordsRaw: string[] = [];
      histories.forEach(h => {
        if ((h.musicInfo as any)?.isSkipped) return;
        const tags = (h.musicInfo as any)?.tags || [];
        tags.forEach((tag: string) => {
          const normalized = normalizeText(tag);
          if (isValidTagKeyword(normalized)) {
            tagKeywordsRaw.push(normalized);
          }
        });
      });
      
      const dedupedKeywords = dedupeSimilarKeywords(tagKeywordsRaw);
      
      for (const tag of dedupedKeywords) {
        const normTag = normalizeText(tag);
        if (normTag === normalizedInput) return tag;
        if (normTag.includes(normalizedInput) || normalizedInput.includes(normTag)) {
          return tag;
        }
        if (keywordSimilarity(normTag, normalizedInput) >= 0.6) {
          return tag;
        }
      }
    } catch (err) {
      logger.error('music', 'Failed to resolve similar keyword', { error: err });
    }
    
    return inputKeyword;
  }

  async function addKeywordBlacklist(targetId: string, keyword: string, isPersonal: boolean, guildId?: string): Promise<RuntimeResponse> {
    const refGuildId = guildId || (!isPersonal ? targetId : undefined);
    let resolvedKeyword = keyword;
    if (refGuildId) {
      resolvedKeyword = await resolveSimilarKeyword(refGuildId, keyword);
    }
    const normalized = (resolvedKeyword || '').toLowerCase().trim();
    if (!normalized) {
      return { ok: false, message: '올바른 키워드를 입력해주세요.' };
    }
    try {
      if (isPersonal) {
        await UserKeywordBlacklist.findOrCreate({ where: { userId: targetId, keyword: normalized } });
      } else {
        await KeywordBlacklist.findOrCreate({ where: { guildId: targetId, keyword: normalized } });
      }
      notifyMusicUpdate(targetId);
      return { ok: true, message: `키워드 '${normalized}'를 블랙리스트에 추가했습니다.` };
    } catch (err: any) {
      logger.error('music', `Failed to add blacklist for ${targetId}`, { error: err.stack });
      return { ok: false, message: `블랙리스트 추가 중 오류가 발생했습니다: ${err.message}` };
    }
  }

  async function removeKeywordBlacklist(targetId: string, keyword: string, isPersonal: boolean, guildId?: string): Promise<RuntimeResponse> {
    const refGuildId = guildId || (!isPersonal ? targetId : undefined);
    let resolvedKeyword = keyword;
    if (refGuildId) {
      resolvedKeyword = await resolveSimilarKeyword(refGuildId, keyword);
    }
    const normalized = (resolvedKeyword || '').toLowerCase().trim();
    if (!normalized) {
      return { ok: false, message: '올바른 키워드를 입력해주세요.' };
    }
    try {
      if (isPersonal) {
        await UserKeywordBlacklist.destroy({ where: { userId: targetId, keyword: normalized } });
      } else {
        await KeywordBlacklist.destroy({ where: { guildId: targetId, keyword: normalized } });
      }
      notifyMusicUpdate(targetId);
      return { ok: true, message: `키워드 '${normalized}'를 블랙리스트에서 제거했습니다.` };
    } catch (err: any) {
      logger.error('music', `Failed to remove blacklist for ${targetId}`, { error: err.stack });
      return { ok: false, message: `블랙리스트 제거 중 오류가 발생했습니다: ${err.message}` };
    }
  }

  async function getKeywordPins(targetId: string, isPersonal: boolean): Promise<{ ok: boolean; keywords: string[] }> {
    try {
      if (isPersonal) {
        const records = await UserKeywordPin.findAll({ where: { userId: targetId } });
        return { ok: true, keywords: records.map(r => r.keyword) };
      } else {
        const records = await KeywordPin.findAll({ where: { guildId: targetId } });
        return { ok: true, keywords: records.map(r => r.keyword) };
      }
    } catch (err: any) {
      logger.error('music', `Failed to get pins for ${targetId}`, { error: err.stack });
      return { ok: false, keywords: [] };
    }
  }

  async function addKeywordPin(targetId: string, keyword: string, isPersonal: boolean, guildId?: string): Promise<RuntimeResponse> {
    const refGuildId = guildId || (!isPersonal ? targetId : undefined);
    let resolvedKeyword = keyword;
    if (refGuildId) {
      resolvedKeyword = await resolveSimilarKeyword(refGuildId, keyword);
    }
    const normalized = (resolvedKeyword || '').toLowerCase().trim();
    if (!normalized) {
      return { ok: false, message: '올바른 키워드를 입력해주세요.' };
    }
    try {
      if (isPersonal) {
        const count = await UserKeywordPin.count({ where: { userId: targetId } });
        if (count >= 5) {
          return { ok: false, message: '최대 5개까지만 고정할 수 있습니다.' };
        }
        await UserKeywordPin.findOrCreate({ where: { userId: targetId, keyword: normalized } });
      } else {
        const count = await KeywordPin.count({ where: { guildId: targetId } });
        if (count >= 5) {
          return { ok: false, message: '최대 5개까지만 고정할 수 있습니다.' };
        }
        await KeywordPin.findOrCreate({ where: { guildId: targetId, keyword: normalized } });
      }
      notifyMusicUpdate(targetId);
      return { ok: true, message: `키워드 '${normalized}'를 고정 목록에 추가했습니다.` };
    } catch (err: any) {
      logger.error('music', `Failed to add pin for ${targetId}`, { error: err.stack });
      return { ok: false, message: `키워드 고정 중 오류가 발생했습니다: ${err.message}` };
    }
  }

  async function removeKeywordPin(targetId: string, keyword: string, isPersonal: boolean, guildId?: string): Promise<RuntimeResponse> {
    const refGuildId = guildId || (!isPersonal ? targetId : undefined);
    let resolvedKeyword = keyword;
    if (refGuildId) {
      resolvedKeyword = await resolveSimilarKeyword(refGuildId, keyword);
    }
    const normalized = (resolvedKeyword || '').toLowerCase().trim();
    if (!normalized) {
      return { ok: false, message: '올바른 키워드를 입력해주세요.' };
    }
    try {
      if (isPersonal) {
        await UserKeywordPin.destroy({ where: { userId: targetId, keyword: normalized } });
      } else {
        await KeywordPin.destroy({ where: { guildId: targetId, keyword: normalized } });
      }
      notifyMusicUpdate(targetId);
      return { ok: true, message: `키워드 '${normalized}'를 고정 목록에서 제거했습니다.` };
    } catch (err: any) {
      logger.error('music', `Failed to remove pin for ${targetId}`, { error: err.stack });
      return { ok: false, message: `키워드 고정 해제 중 오류가 발생했습니다: ${err.message}` };
    }
  }

  return {
    play,
    skip,
    stop,
    queue,
    loop,
    auto,
    history,
    searchTracks,
    getPlaylist,
    addToPlaylist,
    clearToPlaylist,
    getQueueSnapshot,
    moveQueueItem,
    removeQueueItem,
    shuffleQueue,
    deleteFromPlaylist,
    movePlaylistItem,
    pause,
    previous,
    getKeywords,
    getKeywordBlacklist,
    addKeywordBlacklist,
    removeKeywordBlacklist,
    getKeywordPins,
    addKeywordPin,
    removeKeywordPin
  };
}
