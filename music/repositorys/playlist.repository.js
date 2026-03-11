const { PlayList } = require('../models/playlist');

async function insertPlaylist(userId, music_info) {
  return PlayList.create({ userId, music_info });
}

async function findPlaylist(userId) {
  return await PlayList.findAll({
    where: { userId },
    order: [['id', 'ASC']],
  });
}

async function updatePlaylist(userId, id, music_info, transaction) {
  return PlayList.update(
    { music_info },
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
