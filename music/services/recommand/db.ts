import { KeywordBlacklist } from '../../models/keyword-blacklist';
import { UserKeywordPin } from '../../models/user-keyword-pin';
import { KeywordPin } from '../../models/keyword-pin';
import { logger } from '../../../common/logger';
import { normalizeText } from './utils';

export async function getBlacklistForGuild(guildId: string | null | undefined): Promise<Set<string>> {
  if (!guildId) return new Set<string>();
  try {
    const records = await KeywordBlacklist.findAll({ where: { guildId } });
    return new Set<string>(records.map(r => normalizeText(r.keyword)));
  } catch (err) {
    logger.error('system', `[Recommend Service] Failed to load blacklist for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    return new Set<string>();
  }
}

export async function getPinnedKeywordsForRecommend(
  guildId: string | null,
  userId?: string | null
): Promise<string[]> {
  const dbPins: string[] = [];

  if (userId) {
    try {
      const userPins = await UserKeywordPin.findAll({ where: { userId } });
      dbPins.push(...userPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }
  else if (guildId) {
    try {
      const guildPins = await KeywordPin.findAll({ where: { guildId } });
      dbPins.push(...guildPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  return Array.from(new Set(dbPins));
}
