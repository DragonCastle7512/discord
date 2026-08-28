import { test, describe } from 'node:test';
import assert from 'node:assert';
import { VirtualGuildManager } from '../../scripts/benchmark/virtual-guild-manager';

describe('VirtualGuildManager', () => {
  test('가상 길드 생성 및 식별자 네임스페이스 격리 확인', () => {
    const vgm = new VirtualGuildManager();
    const guild1 = vgm.createVirtualGuild(1);
    const guild2 = vgm.createVirtualGuild(2);

    assert.strictEqual(guild1.id, 'mock-bench-guild-1');
    assert.strictEqual(guild2.id, 'mock-bench-guild-2');
    assert.ok(guild1.id.startsWith('mock-bench-'));
    assert.strictEqual(vgm.getActiveGuilds().length, 2);
  });

  test('가상 길드 컨텍스트 생성 확인', () => {
    const vgm = new VirtualGuildManager();
    const guild = vgm.createVirtualGuild(10);
    const context = vgm.createMockContext(guild);

    assert.strictEqual(context.guild.id, 'mock-bench-guild-10');
    assert.strictEqual(context.channelId, 'mock-text-chan-10');
    assert.strictEqual(context.member.voice.channel.id, 'mock-voice-chan-10');
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
