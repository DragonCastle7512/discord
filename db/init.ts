import { initMusicHistoryModel } from '../music/models/music-history';
import { initPlayListModel } from '../music/models/playlist';
import { KeywordBlacklist, initKeywordBlacklistModel } from '../music/models/keyword-blacklist';
import { UserKeywordBlacklist, initUserKeywordBlacklistModel } from '../music/models/user-keyword-blacklist';
import { KeywordPin, initKeywordPinModel } from '../music/models/keyword-pin';
import { UserKeywordPin, initUserKeywordPinModel } from '../music/models/user-keyword-pin';
import { sequelize } from './sequelize';
import { logger } from '../common/logger';

export async function initDb(): Promise<void> {
    try {
        console.log('db 연결 중...');
        initPlayListModel(sequelize);
        initMusicHistoryModel(sequelize);
        initKeywordBlacklistModel(sequelize);
        initUserKeywordBlacklistModel(sequelize);
        initKeywordPinModel(sequelize);
        initUserKeywordPinModel(sequelize);
        await sequelize.authenticate();

        // 오라클 Sequelize sync 인덱스 중복 생성 버그 우회를 위한 런타임 인덱스 설정 백업
        const modelsToBypass = [KeywordBlacklist, UserKeywordBlacklist, KeywordPin, UserKeywordPin];
        const backupMap = new Map<any, { indexes: any; _indexes: any }>();

        for (const model of modelsToBypass) {
            backupMap.set(model, {
                indexes: model.options.indexes,
                _indexes: (model as any)._indexes
            });
            model.options.indexes = [];
            (model as any)._indexes = [];
        }

        await sequelize.sync({ });

        // 인덱스 원복
        for (const model of modelsToBypass) {
            const backup = backupMap.get(model);
            if (backup) {
                model.options.indexes = backup.indexes;
                (model as any)._indexes = backup._indexes;
            }
        }

        // 오라클 Sequelize 인덱스 중복 생성 버그 우회를 위한 수동 고유 인덱스/제약조건 생성
        const manualIndexes = [
            {
                table: 'KEYWORD_BLACKLIST',
                indexName: 'IX_KW_BLACKLIST_GID_KW',
                columns: ['GUILD_ID', 'KEYWORD']
            },
            {
                table: 'USER_KEYWORD_BLACKLIST',
                indexName: 'IX_UKW_BLACKLIST_UID_KW',
                columns: ['USER_ID', 'KEYWORD']
            },
            {
                table: 'KEYWORD_PIN',
                indexName: 'IX_KW_PIN_GID_KW',
                columns: ['GUILD_ID', 'KEYWORD']
            },
            {
                table: 'USER_KEYWORD_PIN',
                indexName: 'IX_UKW_PIN_UID_KW',
                columns: ['USER_ID', 'KEYWORD']
            }
        ];

        for (const idx of manualIndexes) {
            try {
                await sequelize.query(`CREATE UNIQUE INDEX "${idx.indexName}" ON "${idx.table}" ("${idx.columns.join('", "')}")`);
                console.log(`인덱스 생성 완료: ${idx.indexName}`);
            } catch (err: any) {
                // ORA-00955 (이름이 이미 사용 중임)는 이미 인덱스가 있으므로 예외 무시
                if (err.message && (err.message.includes('ORA-00955') || err.message.includes('ORA-01408'))) {
                    // console.log(`인덱스 이미 존재함: ${idx.indexName}`);
                } else {
                    logger.error('system', `Failed to create index ${idx.indexName}`, { error: err.stack });
                }
            }
        }

        console.log('db 연결 성공!');
    }
    catch (err) {
        logger.error('system', `Database initialization failed: ${err instanceof Error ? err.message : String(err)}`, { error: err });
    }
}