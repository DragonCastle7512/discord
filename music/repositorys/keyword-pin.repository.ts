import { KeywordPin } from '../models/keyword-pin';

export async function findKeywordPinsByGuild(guildId: string): Promise<KeywordPin[]> {
  return KeywordPin.findAll({ where: { guildId } });
}

export async function countKeywordPinsByGuild(guildId: string): Promise<number> {
  return KeywordPin.count({ where: { guildId } });
}

export async function addKeywordPinGuild(guildId: string, keyword: string): Promise<[KeywordPin, boolean]> {
  return KeywordPin.findOrCreate({ where: { guildId, keyword } });
}

export async function removeKeywordPinGuild(guildId: string, keyword: string): Promise<number> {
  return KeywordPin.destroy({ where: { guildId, keyword } });
}
