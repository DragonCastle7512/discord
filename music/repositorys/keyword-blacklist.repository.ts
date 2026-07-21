import { KeywordBlacklist } from '../models/keyword-blacklist';

export async function findKeywordBlacklistByGuild(guildId: string): Promise<KeywordBlacklist[]> {
  return KeywordBlacklist.findAll({ where: { guildId } });
}

export async function addKeywordBlacklistGuild(guildId: string, keyword: string): Promise<[KeywordBlacklist, boolean]> {
  return KeywordBlacklist.findOrCreate({ where: { guildId, keyword } });
}

export async function removeKeywordBlacklistGuild(guildId: string, keyword: string): Promise<number> {
  return KeywordBlacklist.destroy({ where: { guildId, keyword } });
}
