// @ts-ignore
import { Router, Request, Response } from 'express';
import { Client, Guild } from 'discord.js';
import { MusicRuntime, GuildState, PlaylistEntry, TrackInfo, HistoryEntry } from '../music/types';
import { findAllHistory } from '../music/repositorys/music-history.repository';
import { findPlaylist } from '../music/repositorys/playlist.repository';
import { DashboardResponse, MusicItem } from './types';

export function createDashboardRouter(
  client: Client,
  guildStates: Map<string, GuildState>,
  music: MusicRuntime
): Router {
  const router = Router();

  router.get('/dashboard-data', async (req: Request, res: Response) => {
    const guildId = req.query.guildId as string;
    const userId = req.query.userId as string;
    const user = userId ? await client.users.fetch(userId).catch(() => null) : null;
    const avatarURL = user?.displayAvatarURL() || null;

    if (!guildId) {
      res.status(400).json({ error: 'Missing guildId' });
      return;
    }

    const guild: Guild | undefined = client.guilds.cache.get(guildId);
    const state = guildStates.get(guildId);
    const snapshot = music.getQueueSnapshot(guildId);

    let allHistory: HistoryEntry[]  = [];
    try {
      allHistory = await findAllHistory(guildId);
    } catch (e) {
      console.error('History fetch failed:', e);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPlays = allHistory.filter((h: any) => new Date(h.createdAt) >= today).length;

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

    let userPlaylist: MusicItem[] = [];
    if (userId) {
      try {
        const pEntries: PlaylistEntry[] = await findPlaylist(userId);
        userPlaylist = pEntries.map((e: PlaylistEntry) => ({
          title: e.musicInfo?.info?.title || 'Unknown',
          artist: e.musicInfo?.info?.author || 'Unknown',
          uri: e.musicInfo?.info?.uri,
          encoded: e.musicInfo?.encoded,
          artwork: e.musicInfo?.info?.artworkUrl || null
        }));
      } catch (e) {
        console.error('Playlist fetch failed:', e);
      }
    }

    const response: DashboardResponse = {
      server: {
        name: guild?.name || 'Unknown Server',
        // serverIcon: guild?.iconURL() || null,
        userIcon: avatarURL,
        channelName: (guild?.channels.cache.get(state?.textChannelId || '') as any)?.name || '음악-봇'
      },
      musicInfo: {
        currentMusic: snapshot.current ? {
          title: snapshot.current.info.title,
          artist: snapshot.current.info.author,
          artwork: snapshot.current.info.artworkUrl || null,
          duration: snapshot.current.info.length,
          position: state?.player?.position || 0,
          requestedBy: guild?.members.cache.get(snapshot.current.requestedBy || '')?.user.globalName || null,
          avatar: guild?.members.cache.get(snapshot.current.requestedBy || '')?.user.displayAvatarURL() || null,
          isPlaying: Boolean(state?.playing)
        } : null,

        queue: snapshot.queue.map(t => ({
          title: t.info.title,
          artist: t.info.author,
          artwork: t.info.artworkUrl || null,
          duration: t.info.length,
          requestedBy: t.requestedBy || null
        })),
        trending: trendingWithPct.map(t => ({
          title: t.title,
          artist: t.artist,
          artwork: t.artwork,
          count: t.count,
          pct: t.pct
        })),
        playlists: userPlaylist.map(p => ({
          title: p.title,
          artist: p.artist,
          artwork: p.artwork,
          uri: p.uri,
          encoded: p.encoded
        }))
      },
      stats: {
        queueCount: snapshot.queue.length + (snapshot.current ? 1 : 0),
        todayPlays: todayPlays,
        playlistCount: userPlaylist.length
      }
    };

    res.json(response);
  });

  return router;
}
