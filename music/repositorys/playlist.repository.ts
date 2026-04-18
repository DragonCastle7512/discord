import { PlayList } from '../models/playlist';
import { PlaylistEntry, Track } from '../types';
import { Transaction } from 'sequelize';

export async function insertPlaylist(userId: string, musicInfo: Track): Promise<any> {
  return PlayList.create({ userId, musicInfo });
}

export async function findPlaylist(userId: string): Promise<PlaylistEntry[]> {
  const items = await PlayList.findAll({
    where: { userId },
    order: [['id', 'ASC']],
  });
  return items.map(item => item.get({ plain: true })) as unknown as PlaylistEntry[];
}

export async function updatePlaylist(userId: string, id: number, musicInfo: Track, transaction?: Transaction): Promise<any> {
  return PlayList.update(
    { musicInfo },
    { where: { userId, id }, transaction },
  );
}

export async function deletePlaylist(userId: string, id: number): Promise<number> {
  return PlayList.destroy({ where: { userId, id } });
}

export async function clearPlaylist(userId: string): Promise<number> {
  return PlayList.destroy({ where: { userId } });
}
