const { PlayList } = require('../models/playlist');

async function insertPlaylist(userId, musicInfo) {
  return PlayList.create({ userId, musicInfo });
}

async function findPlaylist(userId) {
  return await PlayList.findAll({
    where: { userId },
    order: [['id', 'ASC']],
  });
}

async function updatePlaylist(userId, id, musicInfo, transaction) {
  return PlayList.update(
    { musicInfo },
    { where: { userId, id }, transaction },
  );
}

async function deletePlaylist(userId, id) {
  return PlayList.destroy({ where: { userId, id } });
}

async function clearPlaylist(userId) {
  return PlayList.destroy({ where: { userId } });
}

module.exports = {
  insertPlaylist,
  findPlaylist,
  updatePlaylist,
  deletePlaylist,
  clearPlaylist,
};
