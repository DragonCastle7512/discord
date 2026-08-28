import { test, describe } from 'node:test';
import assert from 'node:assert';
import { VirtualGuildManager } from '../../scripts/benchmark/virtual-guild-manager';

describe('VirtualGuildManager', () => {
  test('가상 길드 생성 및 Snowflake 숫자형 ID 격리 확인', () => {
    const vgm = new VirtualGuildManager();
    const guild1 = vgm.createVirtualGuild(1);
    const guild2 = vgm.createVirtualGuild(2);

    assert.strictEqual(guild1.id, '990000000000000001');
    assert.strictEqual(guild2.id, '990000000000000002');
    assert.ok(/^\d{18}$/.test(guild1.id), 'Snowflake는 18자리 숫자 문자열이어야 함');
    assert.strictEqual(vgm.getActiveGuilds().length, 2);
  });

  test('가상 길드 컨텍스트 생성 확인', () => {
    const vgm = new VirtualGuildManager();
    const guild = vgm.createVirtualGuild(10);
    const context = vgm.createMockContext(guild);

    assert.strictEqual(context.guild.id, '990000000000000010');
    assert.strictEqual(context.channelId, '991000000000000010');
    assert.strictEqual(context.member.voice.channel.id, '992000000000000010');
  });

  test('클리어 시 모든 가상 길드 제거', () => {
    const vgm = new VirtualGuildManager();
    vgm.createVirtualGuild(1);
    vgm.createVirtualGuild(2);
    assert.strictEqual(vgm.getActiveGuilds().length, 2);
    vgm.clear();
    assert.strictEqual(vgm.getActiveGuilds().length, 0);
  });
});
