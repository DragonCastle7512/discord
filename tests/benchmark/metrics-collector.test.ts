import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MetricsCollector } from '../../scripts/benchmark/metrics-collector';

describe('MetricsCollector', () => {
  test('Node.js 이벤트 루프 지연 및 메모리 수집 정상 동작', async () => {
    const collector = new MetricsCollector();
    collector.start();
    
    const start = Date.now();
    while (Date.now() - start < 30) {}
    
    const nodeMetrics = collector.getNodeMetrics();
    collector.stop();

    assert.ok(nodeMetrics.heapUsedMb > 0);
    assert.ok(nodeMetrics.eventLoopLagMeanMs >= 0);
    assert.ok(nodeMetrics.rssMb > 0);
  });

  test('Lavalink 프레임 결손율(deficitRate) 계산 검증', () => {
    const collector = new MetricsCollector();
    const stats = {
      players: 10,
      playingPlayers: 10,
      uptime: 1000,
      memory: { free: 100 * 1024 * 1024, used: 200 * 1024 * 1024, allocated: 300 * 1024 * 1024, reservable: 400 * 1024 * 1024 },
      cpu: { cores: 4, systemLoad: 0.15, lavalinkLoad: 0.10 },
      frameStats: { sent: 950, nulled: 0, deficit: 50 }
    };
    const metrics = collector.parseLavalinkStats(stats);
    assert.strictEqual(metrics.deficitRate, 5.0); // 50 / (950 + 50) = 5%
    assert.strictEqual(metrics.activePlayers, 10);
    assert.strictEqual(metrics.usedMemoryMb, 200);
  });

  test('DB latency 기록 및 지표 산출 검증', () => {
    const collector = new MetricsCollector();
    collector.start();
    collector.recordDbLatency(10, true);
    collector.recordDbLatency(20, true);
    collector.recordDbLatency(30, true);
    collector.recordDbLatency(0, false); // failure

    const dbMetrics = collector.getDbMetrics();
    assert.strictEqual(dbMetrics.totalInserts, 4);
    assert.strictEqual(dbMetrics.failedInserts, 1);
    assert.strictEqual(dbMetrics.insertLatencyMeanMs, 20);
    collector.stop();
  });
});
