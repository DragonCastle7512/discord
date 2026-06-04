import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Track } from '../music/types';
import { sequelize } from '../db/sequelize';
import { initMusicHistoryModel, MusicHistory } from '../music/models/music-history';

describe('Sequelize Model & Legacy Data Oracle Compatibility Tests', () => {
  // 테스트 중 생성된 임시 guildId 목록 (정리용)
  const testGuildIds = [
    'test-compat-guild-read',
    'test-compat-guild-write',
    'test-compat-guild-default'
  ];

  before(async () => {
    // 1. 기존 Oracle DB 인스턴스를 통해 연결 상태 점검
    console.log('기존 Oracle DB와 연결을 검증합니다...');
    await sequelize.authenticate();

    initMusicHistoryModel(sequelize);
  });

  after(async () => {
    console.log('테스트 더미 데이터를 정리합니다...');
    try {
      await MusicHistory.destroy({
        where: {
          guildId: testGuildIds
        }
      });
    } catch (err) {
      console.error('더미 데이터 정리 실패:', err);
    }
    await sequelize.close();
  });

  // [검증 1] 기존 DB의 JSON 데이터 파싱 호환성 검증
  it('should correctly write and read legacy JSON structure to Track type on Oracle DB', async () => {
    const legacyMusicInfo = {
      encoded: 'abc123encodedtrackstring',
      info: {
        title: '옛날 노래 (Legacy Song)',
        author: '옛날 가수',
        uri: 'https://youtube.com/watch?v=123',
        identifier: '123',
        isSeekable: true,
        length: 240000,
        isStream: false,
        position: 0,
        sourceName: 'youtube'
      },
      requestedBy: 'user123'
    };

    // 1. 임시 테스트 데이터를 Oracle DB에 기입
    await MusicHistory.create({
      guildId: 'test-compat-guild-read',
      musicInfo: legacyMusicInfo as unknown as Track
    });

    // 2. 다시 읽어서 타입 매핑 확인 (JSON 컬럼 파싱 정상 검증)
    const record = await MusicHistory.findOne({ where: { guildId: 'test-compat-guild-read' } });
    
    assert.ok(record, 'Oracle DB에서 적재한 데이터를 찾을 수 있어야 합니다.');
    assert.strictEqual(record.musicInfo.encoded, 'abc123encodedtrackstring');
    assert.strictEqual(record.musicInfo.info.title, '옛날 노래 (Legacy Song)');
    assert.strictEqual(record.musicInfo.requestedBy, 'user123');
  });

  // [검증 2] declare 키워드 정상 적용 및 속성 섀도잉 방지 검증
  it('should successfully write a new record and ensure no properties are shadowed (declare check)', async () => {
    const newTrack: Track = {
      encoded: 'newtrackencodedstring',
      info: {
        title: '새로운 노래',
        author: '신인 가수',
        uri: 'https://youtube.com/watch?v=456',
        identifier: '456',
        isSeekable: true,
        length: 180000,
        isStream: false,
        position: 0,
        sourceName: 'youtube'
      },
      requestedBy: 'system'
    };

    const record = await MusicHistory.create({
      guildId: 'test-compat-guild-write',
      musicInfo: newTrack
    });

    assert.ok(record.id, 'Oracle DB의 Auto Increment(BIGINT) id가 정상 반환되어야 합니다.');
    assert.strictEqual(record.guildId, 'test-compat-guild-write');
    assert.deepStrictEqual(record.musicInfo, newTrack);
  });
  
  // [검증 3] 기본값 제약 조건 및 시각 데이터 적재 검증
  it('should auto-populate defaults on DB layer', async () => {
     const track: Track = {
       encoded: 'test',
       info: {
         title: 'T',
         author: 'A',
         uri: 'U',
         identifier: 'I',
         isSeekable: true,
         length: 1,
         isStream: false,
         position: 0,
         sourceName: 'S'
       }
     };
     
     const record = await MusicHistory.create({
       guildId: 'test-compat-guild-default',
       musicInfo: track
     });
     
     // DB에 등록된 기본값(CURRENT_TIMESTAMP)을 메모리 인스턴스에 동기화합니다.
     await record.reload();
     
     // Oracle DB의 현재 시간대로 잘 주입되는지 확인
     assert.ok(record.createdAt instanceof Date, 'createdAt이 올바른 Date 객체여야 합니다.');
     
     const timeDiff = Math.abs(Date.now() - record.createdAt.getTime());
     // 네트워크 지연 및 DB 서버 시차를 감안해 15초 이내로 확인
     assert.ok(timeDiff < 15000, '적재 시간이 현재 로컬 시각과 15초 이내여야 합니다.');
  });
});