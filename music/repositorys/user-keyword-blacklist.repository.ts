import { UserKeywordBlacklist } from '../models/user-keyword-blacklist';

export async function findKeywordBlacklistByUser(userId: string): Promise<UserKeywordBlacklist[]> {
  return UserKeywordBlacklist.findAll({ where: { userId } });
}

export async function addKeywordBlacklistUser(userId: string, keyword: string): Promise<[UserKeywordBlacklist, boolean]> {
  return UserKeywordBlacklist.findOrCreate({ where: { userId, keyword } });
}

export async function removeKeywordBlacklistUser(userId: string, keyword: string): Promise<number> {
  return UserKeywordBlacklist.destroy({ where: { userId, keyword } });
}
