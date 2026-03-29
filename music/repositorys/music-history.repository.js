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

module.exports = {
  insertHistory,
  findAllHistory,
};
