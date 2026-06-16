import { initMusicHistoryModel } from '../music/models/music-history';
import { initPlayListModel } from '../music/models/playlist';
import { initKeywordBlacklistModel } from '../music/models/keyword-blacklist';
import { initUserKeywordBlacklistModel } from '../music/models/user-keyword-blacklist';
import { sequelize } from './sequelize';

export async function initDb(): Promise<void> {
    try {
        console.log('db 연결 중...');
        initPlayListModel(sequelize);
        initMusicHistoryModel(sequelize);
        initKeywordBlacklistModel(sequelize);
        initUserKeywordBlacklistModel(sequelize);
        await sequelize.authenticate();
        await sequelize.sync({ });
        console.log('db 연결 성공!');
    }
    catch (err) {
        console.error(err);
    }
}