const { MusicHistory } = require('../models/music-history');

async function insertHistory(guildId, musicInfo) {
  return MusicHistory.create({ guildId, musicInfo });
}

async function findAllHistory(guildId) {
  return await MusicHistory.findAll({
    where: { guildId },
    order: [['createdAt', 'DESC']],
  });
}

async function findHistoryByRequester(guildId, requestedBy) {
  const items = await findAllHistory(guildId);
  if (!requestedBy) {
    return items;
  }

  return items.filter((item) => {
    const requesterId = item?.musicInfo?.requestedBy;
    return String(requesterId || '') === String(requestedBy);
  });
}

module.exports = {
  insertHistory,
  findAllHistory,
  findHistoryByRequester,
};
