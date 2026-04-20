// @ts-ignore
import { Router, Request, Response } from 'express';
import { Client } from 'discord.js';
import { MusicRuntime, GuildState, PlaylistEntry, TrackInfo, HistoryEntry } from '../music/types';
import { findAllHistory } from '../music/repositorys/music-history.repository';
import { findPlaylist } from '../music/repositorys/playlist.repository';
import { DashboardResponse, MusicItem } from './types';
import { verifyDashboardToken } from '../common/auth';
import { notifyMusicUpdate } from '../common/socket';

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

      // 1. 서버 및 프로필 사진 등 정보
      if (type === 'all') {
        const user = await client.users.fetch(userId).catch(() => null);
        response.server = {
          guildId,
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
          console.error('History fetch failed:', e);
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
        response.stats.existCurrentMusic = (snapshot?.current) ? true : false;
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
      console.error(err);
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
        if (result.ok) notifyMusicUpdate(session.guildId, 'queue');
      } else if (type === 'playlist') {
        result = await music.movePlaylistItem(session.userId, from + 1, to + 1);
        if (result.ok) notifyMusicUpdate(session.guildId, 'playlist');
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
