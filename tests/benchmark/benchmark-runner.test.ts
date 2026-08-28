import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MetricsCollector } from '../../scripts/benchmark/metrics-collector';
import { CircuitBreaker } from '../../scripts/benchmark/circuit-breaker';
import { BenchmarkReporter } from '../../scripts/benchmark/reporter';

describe('Benchmark Integrated Pipeline', () => {
  test('전체 메트릭 수집 -> 차단기 검사 -> 리포트 생성 파이프라인 무결성 확인', () => {
    const collector = new MetricsCollector();
    collector.start();
    const node = collector.getNodeMetrics();
    const lavalink = collector.parseLavalinkStats({
      cpu: { systemLoad: 0.1, lavalinkLoad: 0.05 },
      memory: { used: 500 * 1024 * 1024 },
      frameStats: { sent: 1000, deficit: 0 },
    });
    const db = collector.getDbMetrics();
    collector.stop();

    const cb = new CircuitBreaker({ maxCpuRate: 0.85, maxDeficitRate: 5.0, maxEventLoopLagMs: 150, maxHeapMb: 1500, maxDbFailures: 3 });
    const evalRes = cb.evaluate(lavalink, node, db);
    assert.strictEqual(evalRes.shouldAbort, false);

    const reporter = new BenchmarkReporter({ ocpu: 4, memoryGb: 24, bandwidthGbps: 4 });
    const summary = reporter.generateSummary([{
      stage: { name: 'Test Stage', guildCount: 5, holdSeconds: 1 },
      lavalink, node, db, passed: !evalRes.shouldAbort,
    }]);

    assert.ok(summary.includes('Test Stage'));
  });
});
