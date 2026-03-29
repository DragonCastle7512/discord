const { initMusicHistoryModel } = require('../music/models/music-history');
const { initPlayListModel } = require('../music/models/playlist');
const { sequelize } = require('./sequelize');


async function initDb() {
    try {
        console.log('db 연결 중...');
        initPlayListModel(sequelize);
        initMusicHistoryModel(sequelize);
        await sequelize.authenticate();
        await sequelize.sync({ });
        console.log('db 연결 성공!');
    }
    catch (err) {
        console.error(err);
    }
}
module.exports = { initDb };