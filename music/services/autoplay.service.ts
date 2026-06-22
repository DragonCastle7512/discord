import { Client } from 'discord.js';
import { GuildState, Track } from '../types';
import { findAllHistory } from '../repositorys/music-history.repository';
import { generateSongBatchForMood, selectAndCleanSongsFromSearch } from './mood-service';
import { buildHistoryTagKeywords, dedupeSimilarKeywords, getBlacklistForGuild } from './recommand-service';
import { isDurationInRange } from '../utils/track-parser';
import { logger } from '../../common/logger';


export interface AutoplayDeps {
  client: Client;
  guildStates: Map<string, GuildState>;
  resolveTracks: (query: string) => Promise<{ tracks: Track[]; playlistName: string | null }>;
  playNext: (guildId: string) => Promise<void>;
  getTextChannel: (textChannelId: string | null) => any;
  notifyMusicUpdate: (guildId: string, type?: 'music' | 'queue' | 'playlist' | 'all') => void;
}

/**
 * 추천 서비스 레이어
 * */ 
export function createAutoplayService(deps: AutoplayDeps) {
  const {
    client,
    guildStates,
    resolveTracks,
    playNext,
    getTextChannel,
    notifyMusicUpdate,
  } = deps;

  async function triggerAutoPlay(guildId: string): Promise<void> {
    const state = guildStates.get(guildId);
    if (!state || !state.player || state.playing) return;

    let recommendedUri: string | null = null;
    let recommendedTitle = '';

    const mood = state.autoMood || '잔잔한';

    const excludedTitles: string[] = [];
    if (state.current) {
        excludedTitles.push(`${state.current.info.author} - ${state.current.info.title}`);
    }
    state.history.slice(-30).forEach((track) => {
        if (track.info) {
            excludedTitles.push(`${track.info.author} - ${track.info.title}`);
        }
    });

    if (!state.autoPool || state.autoPool.length === 0) {

        if (mood === '추천 곡') {
            try {
                const historyItems = await findAllHistory(guildId);
                const tagKeywordsRaw = buildHistoryTagKeywords(historyItems, 100);
                const blacklistSet = await getBlacklistForGuild(guildId);
                const tagKeywords = dedupeSimilarKeywords(tagKeywordsRaw)
                    .filter(k => !blacklistSet.has(k))
                    .slice(0, 7);

                if (tagKeywords.length > 0) {
                    const shuffledKeywords = [...tagKeywords].sort(() => Math.random() - 0.5);
                    const selectedKeywords = shuffledKeywords.slice(0, Math.min(5, shuffledKeywords.length));
                    // console.log(tagKeywords+"\n"+selectedKeywords);

                    const searchResults: Track[] = [];
                    for (const keyword of selectedKeywords) {
                        try {
                            const resolved = await resolveTracks(keyword);
                            const tracks = resolved?.tracks || [];
                            if (Array.isArray(tracks)) {
                                // 1m 30s ~ 6m duration filtering
                                const filtered = tracks.filter(t => isDurationInRange(t.info.length));
                                searchResults.push(...filtered);
                            }
                        }
                        catch (searchErr) {
                            console.error(`[AutoPlay Mood] Lavalink search failed for keyword "${keyword}":`, searchErr);
                        }
                    }

                    const videoTitles = searchResults
                        .map(track => {
                            if (track.info) {
                                return `${track.info.author} - ${track.info.title}`;
                            }
                            return null;
                        })
                        .filter((t): t is string => !!t);

                    if (videoTitles.length > 0) {
                        const tagsString = tagKeywords.map(k => `#${k}`).join(', ');
                        const shuffledTitles = videoTitles.sort(() => Math.random() - 0.5);

                        const batch = await selectAndCleanSongsFromSearch(shuffledTitles, tagsString, excludedTitles, 20);
                        const cleanBatch = Array.isArray(batch) ? batch : [];
                        state.autoPool = cleanBatch;
                        logger.info('ai', `[AutoPlay Recommend] Auto pool replenished with ${cleanBatch.length} songs`, {
                            selectedKeywords,
                            tagKeywords,
                            songs: cleanBatch,
                        });
                    }
                    else {
                        const textChannel = getTextChannel(state.textChannelId);
                        if (textChannel) {
                            textChannel.send('[오토모드] 최근 히스토리가 부족하여, 자동 재생을 비활성화합니다. 더 많은 곡을 재생해 주세요!').catch(console.error);
                        }
                        state.auto = false;
                        state.autoPool = [];
                        notifyMusicUpdate(guildId, 'music');
                        return;
                    }
                }
                else {
                    const textChannel = getTextChannel(state.textChannelId);
                    if (textChannel) {
                        textChannel.send('[오토모드] 최근 히스토리가 부족해 추천 곡을 자동 재생할 수 없어요! 더 많은 곡을 먼저 재생해 주세요.').catch(console.error);
                    }
                    state.auto = false;
                    state.autoPool = [];
                    notifyMusicUpdate(guildId, 'music');
                    return;
                }
            }
            catch (err: any) {
                logger.error('ai', 'AI tag recommendation failed in autoplay', { error: err.stack });
                const textChannel = getTextChannel(state.textChannelId);
                if (textChannel) {
                    textChannel.send('[오토모드] 추천 곡을 준비하는 중 오류가 발생하여 자동 재생을 비활성화합니다. 더 많은 곡을 재생해 주세요!').catch(console.error);
                }
                state.auto = false;
                state.autoPool = [];
                notifyMusicUpdate(guildId, 'music');
                return;
            }
        }
        else {
            try {
                const batch = await generateSongBatchForMood(mood, excludedTitles, 20);
                state.autoPool = Array.isArray(batch) ? batch : [];
                logger.info('ai', `[AutoPlay Mood] Replenished pool with ${state.autoPool.length} songs for "${mood}"`, {
                    mood,
                    songs: state.autoPool,
                });
            }
            catch (err: any) {
                logger.error('ai', 'generateSongBatchForMood failed in autoplay', { error: err.stack, mood });
                throw new Error(`generateSongBatchForMood failed: ${err.message}`);
            }
        }
    }

    while (state.autoPool && state.autoPool.length > 0 && !recommendedUri) {
        const generatedQuery = state.autoPool.shift();
        if (generatedQuery) {
            const isExcluded = excludedTitles.some(excluded => 
                excluded.toLowerCase().replace(/\s+/g, '') === generatedQuery.toLowerCase().replace(/\s+/g, '')
            );
            if (isExcluded) {
                logger.info('ai', `[AutoPlay Mood] Skipping duplicate song from history: ${generatedQuery}`);
                continue;
            }

            logger.info('ai', `[AutoPlay Mood] Selected from pool: ${generatedQuery} (${state.autoPool.length} left)`);
            recommendedTitle = generatedQuery;

            try {
                const resolved = await resolveTracks(generatedQuery);
                if (resolved && resolved.tracks.length > 0) {
                    const firstTrack = resolved.tracks[0];
                    if (isDurationInRange(firstTrack.info.length)) {
                        recommendedUri = firstTrack.info.uri;
                        recommendedTitle = firstTrack.info.title;
                    } else {
                        logger.info('ai', `[AutoPlay Mood] Skipping song due to duration filter mismatch: ${generatedQuery} (${firstTrack.info.length}ms)`);
                    }
                }
                else {
                    logger.warn('ai', `[AutoPlay Mood] Resolving returned empty tracks for query: "${generatedQuery}"`);
                }
            }
            catch (err) {
                logger.error('ai', `Resolve failed for autoplay mood query "${generatedQuery}"`, { error: (err as any)?.stack });
            }
        }
    }

    if (!recommendedUri) {
        const textChannel = getTextChannel(state.textChannelId);
        if (textChannel) {
            if (mood === '추천 곡') {
                textChannel.send('[오토모드] 추천 곡 리스트의 모든 곡을 로드하는 데 실패하여 자동 재생을 비활성화합니다. 더 많은 곡을 재생해 보세요!').catch(console.error);
            }
            else {
                textChannel.send(`[오토모드] '${mood}' 분위기의 자동 재생 곡을 준비하는 데 실패했어요.`).catch(console.error);
            }
        }
        if (mood === '추천 곡') {
            state.auto = false;
            state.autoPool = [];
            notifyMusicUpdate(guildId, 'music');
            return;
        }
        throw new Error(`Failed to resolve auto-play song for mood "${mood}"`);
    }

    try {
        const resolved = await resolveTracks(recommendedUri);
        if (resolved && resolved.tracks.length > 0) {
            const track = {
                ...resolved.tracks[0],
                requestedBy: client.user?.id || null,
            };

            state.queue.push(track);
            await playNext(guildId);
        }
        else {
            throw new Error('Resolve returned empty tracks');
        }
    }
    catch (err) {
        console.error('Autoplay resolve/play failed:', err);
        const textChannel = getTextChannel(state.textChannelId);
        if (textChannel) {
            textChannel.send(`자동 재생 곡 (**${recommendedTitle}**)을 준비하는 데 실패했어요.`).catch(console.error);
        }
        throw err;
    }
  }

  return { triggerAutoPlay };
}
