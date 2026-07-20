// @ts-ignore
import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import { Op } from 'sequelize';

let lastCpuUsage = 0;
let lastCpuTicks = getCpuTicks();

function getCpuTicks() {
  const cpus = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;
  cpus.forEach(cpu => {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  });
  return { idle, total: user + nice + sys + idle + irq };
}

setInterval(() => {
  const currentTicks = getCpuTicks();
  const idleDifference = currentTicks.idle - lastCpuTicks.idle;
  const totalDifference = currentTicks.total - lastCpuTicks.total;
  
  if (totalDifference > 0) {
    lastCpuUsage = Math.round((1 - idleDifference / totalDifference) * 100);
  }
  lastCpuTicks = currentTicks;
}, 2000).unref();

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

        const todayDateStr = new Date().toLocaleDateString('sv-SE');
        const todayPlays = allHistory.filter((h: any) => {
          const hDate = new Date(h.createdAt);
          return hDate.toLocaleDateString('sv-SE') === todayDateStr;
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

      // 최근 30일 날짜 템플릿 생성
      const errorLabels: string[] = [];
      const errorTrendMap = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
        errorLabels.push(dateStr);
        errorTrendMap.set(dateStr, 0);
      }

      // 경고 및 에러 건수 집계
      entries.forEach(entry => {
        const level = (entry.level || '').toUpperCase();
        if (['WARN', 'ERROR'].includes(level) && entry.timestamp) {
          const entryDate = new Date(entry.timestamp);
          const entryDateStr = entryDate.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
          if (errorTrendMap.has(entryDateStr)) {
            errorTrendMap.set(entryDateStr, (errorTrendMap.get(entryDateStr) || 0) + 1);
          }
        }
      });

      const errorTrends = errorLabels.map(label => errorTrendMap.get(label) || 0);

      res.json({
        logs: entries,
        user: {
          avatarUrl,
          displayName
        },
        errorLabels,
        errorTrends
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/statistics', verifyToken, async (req: Request, res: Response) => {
    const session = (req as any).session;
    if (!process.env.OWNER_ID || session.userId !== process.env.OWNER_ID) {
      res.status(401).json({ error: '권한이 없습니다.' });
      return;
    }

    const selectedGuildId = req.query.guildId as string;
    const isAll = !selectedGuildId || selectedGuildId === 'ALL';

    try {
      // 1. 봇이 참가 중인 서버(Guild) 목록 획득
      const guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name }));

      // 2. 음악 재생 내역 조회 (정합성을 위해 날짜 필터 완전히 제거)
      const historyWhere: any = {};
      if (!isAll) {
        historyWhere.guildId = selectedGuildId;
      }

      const histories = await MusicHistory.findAll({
        where: historyWhere,
        order: [['createdAt', 'DESC']]
      });

      // 3. 인기 곡 집계 (Top 10 / Top 5)
      const songCountMap = new Map<string, { title: string; artist: string; count: number; artworkUrl: string | null }>();
      histories.forEach(h => {
        const info = h.musicInfo;
        const trackInfo = info?.info;
        if (!trackInfo) return;
        const key = `${trackInfo.title}_${trackInfo.author}`;
        const existing = songCountMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          songCountMap.set(key, {
            title: trackInfo.title || '알 수 없는 곡',
            artist: trackInfo.author || '알 수 없는 아티스트',
            count: 1,
            artworkUrl: trackInfo.artworkUrl || null
          });
        }
      });
      const trendingSongs = Array.from(songCountMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      // 4. AI 호출 통계 산출 (ai-calls.json 기반)
      const aiCallsFilePath = path.join(process.cwd(), 'logs/ai-calls.json');
      let totalAiCalls = 0;
      let todayAiCalls = 0;
      const aiCallTrendMap = new Map<string, number>();

      // 최근 7일 날짜 템플릿 생성
      const dateLabels: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
        dateLabels.push(dateStr);
        aiCallTrendMap.set(dateStr, 0);
      }

      const now = new Date();
      const todayKstStr = now.toLocaleDateString('sv-SE');
      const todayStr = now.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });

      if (fs.existsSync(aiCallsFilePath)) {
        try {
          const aiData = JSON.parse(fs.readFileSync(aiCallsFilePath, 'utf8'));
          if (isAll) {
            totalAiCalls = aiData.totalAiCalls || 0;
            // 최근 7일 추이 집계
            for (let i = 6; i >= 0; i--) {
              const d = new Date();
              d.setDate(d.getDate() - i);
              const keyDateStr = d.toLocaleDateString('sv-SE');
              const dateLabel = d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
              
              const dayStat = aiData.dailyStats?.[keyDateStr];
              if (dayStat) {
                aiCallTrendMap.set(dateLabel, dayStat.total || 0);
                if (keyDateStr === todayKstStr) {
                  todayAiCalls = dayStat.total || 0;
                }
              }
            }
          } else {
            // 특정 길드(selectedGuildId) 기준
            for (const [keyDateStr, dayStat] of Object.entries(aiData.dailyStats || {})) {
              const guildCount = (dayStat as any).guilds?.[selectedGuildId] || 0;
              totalAiCalls += guildCount;
              if (keyDateStr === todayKstStr) {
                todayAiCalls = guildCount;
              }
              
              // 최근 7일 범위 확인 후 트렌드 맵 매핑
              const d = new Date(keyDateStr);
              const dateLabel = d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
              if (aiCallTrendMap.has(dateLabel)) {
                aiCallTrendMap.set(dateLabel, guildCount);
              }
            }
          }
        } catch {}
      }

      // 5. 일자별 음악 재생 통계 집계 (최근 7일)
      const playTrendMap = new Map<string, number>();
      dateLabels.forEach(label => playTrendMap.set(label, 0));
      histories.forEach(h => {
        const hDate = new Date(h.createdAt);
        const dateStr = hDate.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
        if (playTrendMap.has(dateStr)) {
          playTrendMap.set(dateStr, (playTrendMap.get(dateStr) || 0) + 1);
        }
      });

      const playCounts = dateLabels.map(label => playTrendMap.get(label) || 0);
      const aiCallCounts = dateLabels.map(label => aiCallTrendMap.get(label) || 0);

      // 오늘 전체 음악 재생 카운트 계산
      const todayPlayCount = histories.filter(h => {
        const hDate = new Date(h.createdAt);
        return hDate.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) === todayStr;
      }).length;

      // 6. 시간대별(KST 0~23시) 음악 재생 통계 집계
      const hourlyStats = new Array(24).fill(0);
      histories.forEach(h => {
        const hDate = new Date(h.createdAt);
        const hour = hDate.getHours();
        if (hour >= 0 && hour < 24) {
          hourlyStats[hour]++;
        }
      });

      res.json({
        ok: true,
        guilds,
        summary: {
          totalPlays: histories.length,
          todayPlays: todayPlayCount,
          totalAiCalls,
          todayAiCalls
        },
        trendingSongs,
        activityTrends: {
          dates: dateLabels,
          playCounts,
          aiCallCounts
        },
        hourlyStats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/system-resources', verifyToken, async (req: Request, res: Response) => {
    const session = (req as any).session;
    if (!process.env.OWNER_ID || session.userId !== process.env.OWNER_ID) {
      res.status(401).json({ error: '권한이 없습니다.' });
      return;
    }

    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memoryUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

      const shoukaku = (client as any).shoukaku;
      let lavalinkConnected = false;
      if (shoukaku && shoukaku.nodes) {
        const nodes = Array.from(shoukaku.nodes.values());
        lavalinkConnected = nodes.some((node: any) => 
          node.state === 1 || 
          node.state === 'CONNECTED' || 
          node.readyState === 1 || 
          node.state === 'ready'
        );
      }

      res.json({
        ok: true,
        cpu: lastCpuUsage,
        memory: memoryUsage,
        ping: client.ws.ping || 0,
        lavalink: lavalinkConnected ? 'connected' : 'disconnected'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
