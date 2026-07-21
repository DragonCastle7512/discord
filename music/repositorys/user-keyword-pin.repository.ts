import { UserKeywordPin } from '../models/user-keyword-pin';

export async function findKeywordPinsByUser(userId: string): Promise<UserKeywordPin[]> {
  return UserKeywordPin.findAll({ where: { userId } });
}

export async function countKeywordPinsByUser(userId: string): Promise<number> {
  return UserKeywordPin.count({ where: { userId } });
}

export async function addKeywordPinUser(userId: string, keyword: string): Promise<[UserKeywordPin, boolean]> {
  return UserKeywordPin.findOrCreate({ where: { userId, keyword } });
}

export async function removeKeywordPinUser(userId: string, keyword: string): Promise<number> {
  return UserKeywordPin.destroy({ where: { userId, keyword } });
}
