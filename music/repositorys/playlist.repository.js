const { PlayList } = require('../models/playlist');

async function insertPlaylist(userId, music_info) {
  return PlayList.create({ userId, music_info });
}

async function findPlaylist(userId) {
  const playlist = await PlayList.findAll({
    where: { userId },
    order: [['id', 'ASC']],
  });
  return playlist.map((music) => music.music_info);
}

async function clearPlaylist(userId) {
  return PlayList.destroy({ where: { userId } });
}

module.exports = {
  insertPlaylist,
  findPlaylist,
  clearPlaylist,
};
