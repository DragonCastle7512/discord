import { findKeywordBlacklistByGuild } from '../../repositorys/keyword-blacklist.repository';
import { findKeywordBlacklistByUser } from '../../repositorys/user-keyword-blacklist.repository';
import { findKeywordPinsByUser } from '../../repositorys/user-keyword-pin.repository';
import { findKeywordPinsByGuild } from '../../repositorys/keyword-pin.repository';
import { logger } from '../../../common/logger';
import { normalizeText } from './utils';

export async function getBlacklistForGuild(guildId: string | null | undefined): Promise<Set<string>> {
  if (!guildId) return new Set<string>();
  try {
    const records = await findKeywordBlacklistByGuild(guildId);
    return new Set<string>(records.map(r => normalizeText(r.keyword)));
  } catch (err) {
    logger.error('system', `[Recommend Service] Failed to load blacklist for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    return new Set<string>();
  }
}

export async function getUserBlacklist(userId: string ): Promise<Set<string>> {
  if (!userId) return new Set<string>();
  try {
    const records = await findKeywordBlacklistByUser(userId);
    return new Set<string>(records.map(r => normalizeText(r.keyword)));
  } catch (err) {
    logger.error('system', `[Recommend Service] Failed to load userId for guild ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
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
      const userPins = await findKeywordPinsByUser(userId);
      dbPins.push(...userPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for user ${userId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }
  else if (guildId) {
    try {
      const guildPins = await findKeywordPinsByGuild(guildId);
      dbPins.push(...guildPins.map(p => p.keyword));
    } catch (err) {
      logger.error('system', `[Recommend Service] Failed to load pinned keywords for guild ${guildId}`, { error: err instanceof Error ? err.stack : String(err) });
    }
  }

  return Array.from(new Set(dbPins));
}

