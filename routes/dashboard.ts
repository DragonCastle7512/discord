// @ts-ignore
import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { MusicRuntime, GuildState, PlaylistEntry, TrackInfo, HistoryEntry, Track } from '../music/types';
import { findAllHistory } from '../music/repositorys/music-history.repository';
import { findPlaylist } from '../music/repositorys/playlist.repository';
import { DashboardResponse, MusicItem } from './types';
import { verifyDashboardToken } from '../common/auth';
import { notifyMusicUpdate } from '../common/socket';
import { isDurationInRange } from '../music/utils/track-parser';
import { logger } from '../common/logger';
import { GuildConfig } from '../music/models/guild-config';

import { KeywordBlacklist } from '../music/models/keyword-blacklist';
import { MusicHistory } from '../music/models/music-history';
import { UserKeywordBlacklist } from '../music/models/user-keyword-blacklist';
import { KeywordPin } from '../music/models/keyword-pin';
import { UserKeywordPin } from '../music/models/user-keyword-pin';
import { dedupeSimilarKeywords, buildHistoryTagKeywords, isValidTagKeyword, normalizeText, isKeywordMatched } from '../music/services/recommand-service';


export function createDashboardRouter(
  client: Client,
  guildStates: Map<string, GuildState>,
  music: MusicRuntime
): Router {
  const router = Router();

  router.get('/dashboard-data', async (req: Request, res: Response) => {
    const token = req.query.token as string;
    const type = (req.query.type as string) || 'all'; // music, queue, playlist, all

    const session = verifyDashboardToken(token);
    if (!session) {
      res.status(401).json({ error: '인증 실패' });
      return;
    }

    const { guildId, userId } = session;
    const response: DashboardResponse = {
      server: {
        guildId: '',
        userId: '',
        name: '',
        // serverIcon: null,
        userIcon: null,
        channelName: ''
      },
      musicInfo: {
        currentMusic: null,
        queue: [],
        trending: [],
        playlists: []
      },
      stats: {
        queueCount: 0,
        todayPlays: 0,
        playlistCount: 0,
        existCurrentMusic: false,
      }
    };

    try {
      const state = guildStates.get(guildId);
      const snapshot = music.getQueueSnapshot(guildId);

      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      response.stats.existCurrentMusic = (snapshot?.current) ? true : false;

      // 1. 서버 및 프로필 사진 등 정보
      if (type === 'all') {
        const user = await client.users.fetch(userId).catch(() => null);
        response.server = {
          guildId,
          userId,
          name: guild?.name || 'Unknown Server',
          // serverIcon: guild?.iconURL() || null,
          userIcon: user?.displayAvatarURL() || null,
          channelName: (guild?.channels.cache.get(state?.textChannelId || '') as any)?.name || '음악-봇'
        };
      }

      // 2. 현재 곡 및 인기 차트
      if (type === 'all' || type === 'music') {
        response.musicInfo.currentMusic = snapshot.current ? {
          title: snapshot.current.info.title,
          artist: snapshot.current.info.author,
          artwork: snapshot.current.info.artworkUrl || null,
          duration: snapshot.current.info.length,
          position: state?.player?.position || 0,
          requestedBy: guild?.members.cache.get(snapshot.current.requestedBy || '')?.user.globalName || null,
          avatar: guild?.members.cache.get(snapshot.current.requestedBy || '')?.user.displayAvatarURL() || null,
          isPlaying: Boolean(state?.playing)
        } : null;

        let allHistory: HistoryEntry[]  = [];
        try {
          allHistory = await findAllHistory(guildId);
        } catch (e) {
          logger.error('music', 'History fetch failed in dashboard data', { error: e });
        }

        const now = Date.now();
        const KST_OFFSET = 9 * 60 * 60 * 1000;
        const todayKstStr = new Date(now + KST_OFFSET).toISOString().split('T')[0];
        const todayPlays = allHistory.filter((h: any) => {
          const hDateKst = new Date(new Date(h.createdAt).getTime() + KST_OFFSET);
          return hDateKst.toISOString().split('T')[0] === todayKstStr;
        }).length;

        const counts = new Map<string, { title: string, artist: string, count: number, artwork: string | null }>();
        allHistory.forEach((h: any) => {
          const info = h.musicInfo?.info;
          if (!info) return;
          const key = info.uri || info.title;
          const existing = counts.get(key) || { title: info.title, artist: info.author, count: 0, artwork: info.artworkUrl || null };
          existing.count++;
          counts.set(key, existing);
        });

        const trending = Array.from(counts.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        const maxTrend = trending.length > 0 ? trending[0].count : 1;
        const trendingWithPct = trending.map(t => ({ ...t, pct: Math.round((t.count / maxTrend) * 100) }));

        response.musicInfo.trending = trendingWithPct;
        response.stats.todayPlays = todayPlays
      }

      // 3. 현재 대기열 및 개수
      if (type === 'all' || type === 'music' || type === 'queue') {
        response.musicInfo.queue = snapshot.queue.map(t => ({
            title: t.info.title,
            artist: t.info.author,
            artwork: t.info.artworkUrl || null,
            duration: t.info.length,
            requestedBy: t.requestedBy || null
          })),
        response.stats.queueCount = response.musicInfo.queue.length + (snapshot.current ? 1 : 0);
      }

      // 4. 플레이리스트 목록 및 개수
      if (type === 'all' || type === 'playlist') {
        const pEntries = await findPlaylist(userId).catch(() => []);
        response.musicInfo.playlists = pEntries.map((e: PlaylistEntry) => ({
          title: e.musicInfo?.info?.title || 'Unknown',
          artist: e.musicInfo?.info?.author || 'Unknown',
          uri: e.musicInfo?.info?.uri,
          encoded: e.musicInfo?.encoded,
          artwork: e.musicInfo?.info?.artworkUrl || null
        }));
        response.stats.playlistCount = response.musicInfo.playlists.length;
      }

      res.json(response);
    } catch (err) {
      logger.error('system', `Dashboard data get failed: ${err instanceof Error ? err.message : String(err)}`, { error: err });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.post('/move-item', async (req: Request, res: Response) => {
    const { token, type, from, to } = req.body;
    const session = verifyDashboardToken(token);

    if (!session) {
      res.status(401).json({ error: '인증되지 않은 접근입니다.' });
      return;
    }

    try {
      let result;
      if (type === 'queue') {
        result = music.moveQueueItem(session.guildId, from + 1, to + 1);
      } else if (type === 'playlist') {
        result = await music.movePlaylistItem(session.userId, from + 1, to + 1);
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/delete-item', async (req: Request, res: Response) => {
    const { token, type, index } = req.body;
    const session = verifyDashboardToken(token);

    if (!session) {
      res.status(401).json({ error: '인증되지 않은 접근입니다.' });
      return;
    }

    try {
      let result;
      if (type === 'queue') {
        result = music.removeQueueItem(session.guildId, index + 1);
      } else if (type === 'playlist') {
        result = await music.deleteFromPlaylist(session.userId, index + 1);
      }
      res.json({ ok: result?.ok || false, message: result?.message });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/play-music', async (req: Request, res: Response) => {
    const { token, url } = req.body;
    const session = verifyDashboardToken(token);

    if (!session) {
      res.status(401).json({ error: '인증되지 않은 접근입니다.' });
      return;
    }

    try {
      const guild = await client.guilds.fetch(session.guildId);
      const member = await guild.members.fetch(session.userId);
      
      let targetChannelId = member.voice.channelId;
      try {
        const config = await GuildConfig.findOne({ where: { guildId: session.guildId } });
        if (config && config.musicChannelId) {
          targetChannelId = config.musicChannelId;
        }
      } catch (err) {
        logger.error('music', 'Dashboard play failed to get guild config', { error: err });
      }

      const context = {
        guild,
        member,
        user: member.user,
        channelId: targetChannelId
      };

      const result = await music.play(context, url);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  router.post('/control', async (req: Request, res: Response) => {
    const { token, action } = req.body;
    const session = verifyDashboardToken(token);

    if (!session) {
      res.status(401).json({ error: '인증되지 않은 접근입니다.' });
      return;
    }

    try {
      let result;
      switch (action) {
        case 'skip':
          result = await music.skip(session.guildId);
          break;
        case 'previous':
          result = await music.previous(session.guildId);
          break;
        case 'loop': {
          const loopRes = await music.loop(session.guildId, null);
          result = { ok: true, enabled: loopRes.enabled };
          break;
        }
        case 'pause':
          result = await music.pause(session.guildId);
          break;
        case 'shuffle':
          result = music.shuffleQueue(session.guildId);
          break;
        case 'addPlaylist':
          result = await music.addToPlaylist(session.guildId, session.userId, '');
          break;
        default:
          return res.status(400).json({ ok: false, message: 'Unknown action' });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  async function verifyToken(req: Request, res: Response, next: any) {
    const token = (req.query.token as string) || (req.body.token as string);
    const session = verifyDashboardToken(token);
    if (!session) {
      res.status(401).json({ error: '인증 실패' });
      return;
    }
    (req as any).session = session;
    next();
  }

  router.get('/admin/keywords', verifyToken, async (req: Request, res: Response) => {
    try {
      const session = (req as any).session;
      const mode = (req.query.mode as string) || 'server';

      const histories = await MusicHistory.findAll({ where: { guildId: session.guildId } });
      const keywordMap = new Map<string, number>();

      const filteredHistories = mode === 'personal'
        ? histories.filter(h => String((h.musicInfo as any)?.requestedBy || '') === String(session.userId))
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
      if (mode === 'personal') {
        const blacklistRecords = await UserKeywordBlacklist.findAll({ where: { userId: session.userId } });
        blacklistSet = new Set(blacklistRecords.map(r => r.keyword.toLowerCase().trim()));
      } else {
        const blacklistRecords = await KeywordBlacklist.findAll({ where: { guildId: session.guildId } });
        blacklistSet = new Set(blacklistRecords.map(r => r.keyword.toLowerCase().trim()));
      }

      // 고정 키워드 조회
      let pinnedSet = new Set<string>();
      if (mode === 'personal') {
        const pinRecords = await UserKeywordPin.findAll({ where: { userId: session.userId } }).catch(() => []);
        pinnedSet = new Set(pinRecords.map(r => normalizeText(r.keyword)));
      } else {
        const pinRecords = await KeywordPin.findAll({ where: { guildId: session.guildId } }).catch(() => []);
        pinnedSet = new Set(pinRecords.map(r => normalizeText(r.keyword)));
      }

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

      let recommendation = { keywords: [] as string[], items: [] as any[] };
      if (keywords.length > 0) {
        // 고정 키워드가 믹싱 시 최우선 배치되도록 정렬하여 상위 3개 키워드 추출
        const sortedForRec = [...keywords].sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.freq - a.freq || a.tag.localeCompare(b.tag);
        });
        const topKeywords = sortedForRec.slice(0, 3).map(k => k.tag);

        try {
          const searchPromises = topKeywords.map(async (kw) => {
            try {
              const res = await music.searchTracks(kw);
              const rawTracks = res.tracks || [];
              // 1m 30s ~ 6m duration filter
              return rawTracks.filter((t: Track) => isDurationInRange(t.info.length));
            } catch (err) {
              logger.error('music', `[GET /admin/keywords] search for "${kw}" failed`, { error: err });
              return [];
            }
          });
          const searchResults = await Promise.all(searchPromises);

          // Mix (interleave) tracks from search results
          const mixedTracks: Track[] = [];
          const maxTracks = Math.max(...searchResults.map(r => r.length));
          for (let i = 0; i < maxTracks; i++) {
            for (let j = 0; j < searchResults.length; j++) {
              if (searchResults[j][i]) {
                mixedTracks.push(searchResults[j][i]);
              }
            }
          }

          // Deduplicate tracks
          const seenIds = new Set<string>();
          const dedupedTracks = mixedTracks.filter(t => {
            const id = t.info.uri || t.info.identifier;
            if (!id || seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
          });

          recommendation.items = dedupedTracks.slice(0, 10).map((t: Track) => ({
            id: t.info.identifier,
            title: t.info.title,
            artist: t.info.author || '알 수 없음',
            url: t.info.uri || (t.info.identifier ? `https://www.youtube.com/watch?v=${t.info.identifier}` : ''),
            thumbnail: t.info.artworkUrl || (t.info.identifier ? `https://i.ytimg.com/vi/${t.info.identifier}/mqdefault.jpg` : null)
          }));
        } catch (searchErr) {
          logger.error('music', '[GET /admin/keywords] Mixing recommendation failed', { error: searchErr });
        }
      }

      res.json({
        ok: true,
        mode,
        totalKeywordsCount: dedupedKeywordsList.length,
        blacklistCount: blacklistSet.size,
        pinnedCount: pinnedSet.size,
        keywords,
        blacklist: Array.from(blacklistSet),
        pinned: Array.from(pinnedSet),
        recommendation
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/blacklist', verifyToken, async (req: Request, res: Response) => {
    const { keyword, mode } = req.body;
    if (!keyword || typeof keyword !== 'string') {
      res.status(400).json({ error: '올바른 키워드를 입력해주세요.' });
      return;
    }
    try {
      const session = (req as any).session;
      const normalized = keyword.toLowerCase().trim();
      const currentMode = mode || 'server';

      if (currentMode === 'personal') {
        await UserKeywordBlacklist.findOrCreate({ 
          where: { 
            userId: session.userId, 
            keyword: normalized 
          } 
        });
      } else {
        await KeywordBlacklist.findOrCreate({ 
          where: { 
            guildId: session.guildId, 
            keyword: normalized 
          } 
        });
      }
      notifyMusicUpdate(currentMode === 'personal' ? session.userId : session.guildId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/admin/blacklist', verifyToken, async (req: Request, res: Response) => {
    const { keyword, mode } = req.body;
    if (!keyword || typeof keyword !== 'string') {
      res.status(400).json({ error: '올바른 키워드를 입력해주세요.' });
      return;
    }
    try {
      const session = (req as any).session;
      const normalized = keyword.toLowerCase().trim();
      const currentMode = mode || 'server';

      if (currentMode === 'personal') {
        await UserKeywordBlacklist.destroy({ 
          where: { 
            userId: session.userId, 
            keyword: normalized 
          } 
        });
      } else {
        await KeywordBlacklist.destroy({ 
          where: { 
            guildId: session.guildId, 
            keyword: normalized 
          } 
        });
      }
      notifyMusicUpdate(currentMode === 'personal' ? session.userId : session.guildId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/pin', verifyToken, async (req: Request, res: Response) => {
    const { keyword, mode } = req.body;
    if (!keyword || typeof keyword !== 'string') {
      res.status(400).json({ error: '올바른 키워드를 입력해주세요.' });
      return;
    }
    try {
      const session = (req as any).session;
      const normalized = keyword.toLowerCase().trim();
      const currentMode = mode || 'server';

      if (currentMode === 'personal') {
        const count = await UserKeywordPin.count({ where: { userId: session.userId } });
        if (count >= 5) {
          res.status(400).json({ error: '최대 5개까지만 고정할 수 있습니다.' });
          return;
        }
        await UserKeywordPin.findOrCreate({ 
          where: { 
            userId: session.userId, 
            keyword: normalized 
          } 
        });
      } else {
        const count = await KeywordPin.count({ where: { guildId: session.guildId } });
        if (count >= 5) {
          res.status(400).json({ error: '최대 5개까지만 고정할 수 있습니다.' });
          return;
        }
        await KeywordPin.findOrCreate({ 
          where: { 
            guildId: session.guildId, 
            keyword: normalized 
          } 
        });
      }
      notifyMusicUpdate(currentMode === 'personal' ? session.userId : session.guildId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/admin/pin', verifyToken, async (req: Request, res: Response) => {
    const { keyword, mode } = req.body;
    if (!keyword || typeof keyword !== 'string') {
      res.status(400).json({ error: '올바른 키워드를 입력해주세요.' });
      return;
    }
    try {
      const session = (req as any).session;
      const normalized = keyword.toLowerCase().trim();
      const currentMode = mode || 'server';

      if (currentMode === 'personal') {
        await UserKeywordPin.destroy({ 
          where: { 
            userId: session.userId, 
            keyword: normalized 
          } 
        });
      } else {
        await KeywordPin.destroy({ 
          where: { 
            guildId: session.guildId, 
            keyword: normalized 
          } 
        });
      }
      notifyMusicUpdate(currentMode === 'personal' ? session.userId : session.guildId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/admin/search-preview', verifyToken, async (req: Request, res: Response) => {
    const keyword = req.query.keyword as string;
    if (!keyword) {
      res.status(400).json({ error: '검색어를 입력해주세요.' });
      return;
    }

    try {
      const searchResult = await music.searchTracks(keyword);
      const tracks = searchResult.tracks || [];

      // 1m 30s ~ 6m duration filter
      const filteredTracks = tracks.filter((t: Track) => isDurationInRange(t.info.length));

      const items = filteredTracks.slice(0, 10).map((t: Track) => ({
        id: t.info.identifier,
        title: t.info.title,
        artist: t.info.author || '알 수 없음',
        url: t.info.uri || (t.info.identifier ? `https://www.youtube.com/watch?v=${t.info.identifier}` : ''),
        thumbnail: t.info.artworkUrl || (t.info.identifier ? `https://i.ytimg.com/vi/${t.info.identifier}/mqdefault.jpg` : null)
      }));

      res.json({ ok: true, items: items });
    } catch (err: any) {
      logger.error('music', 'search-preview error', { error: err });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/logs-data', verifyToken, async (req: Request, res: Response) => {
    const session = (req as any).session;
    if (!process.env.OWNER_ID || session.userId !== process.env.OWNER_ID) {
      res.status(401).json({ error: '권한이 없습니다.' });
      return;
    }

    const logPath = path.join(__dirname, '../logs/app.log');

    let avatarUrl: string | null = null;
    let displayName = 'Admin';
    try {
      const user = await client.users.fetch(session.userId).catch(() => null);
      if (user) {
        avatarUrl = user.displayAvatarURL() || null;
        displayName = user.globalName || user.username;
      }
    } catch (userErr) {
      logger.error('system', 'Failed to fetch user profile for logs page', { error: userErr });
    }

    if (!fs.existsSync(logPath)) {
      res.json({ logs: [], user: { avatarUrl, displayName } });
      return;
    }

    try {
      const rawContent = fs.readFileSync(logPath, 'utf8');
      const lines = rawContent.split('\n').filter(line => line.trim() !== '');
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null);

      entries.reverse();
      res.json({
        logs: entries,
        user: {
          avatarUrl,
          displayName
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
