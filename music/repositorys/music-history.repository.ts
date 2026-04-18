import { MusicHistory } from '../models/music-history';
import { HistoryEntry, Track } from '../types';

export async function insertHistory(guildId: string, musicInfo: Track): Promise<any> {
  return MusicHistory.create({ guildId, musicInfo });
}

export async function findAllHistory(guildId: string): Promise<HistoryEntry[]> {
  const items = await MusicHistory.findAll({
    where: { guildId },
    order: [['createdAt', 'DESC']],
  });
  return items.map(item => item.get({ plain: true })) as unknown as HistoryEntry[];
}

export async function findHistoryByRequester(guildId: string, requestedBy?: string): Promise<HistoryEntry[]> {
  const items = await findAllHistory(guildId);
  if (!requestedBy) {
    return items;
  }

  return items.filter((item) => {
    const requesterId = (item.musicInfo as any)?.requestedBy;
    return String(requesterId || '') === String(requestedBy);
  });
}
