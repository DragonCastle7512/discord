import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CircuitBreaker } from '../../scripts/benchmark/circuit-breaker';
import { CircuitBreakerThresholds, LavalinkMetrics, NodeMetrics, DbMetrics } from '../../scripts/benchmark/types';

describe('CircuitBreaker', () => {
  const defaultThresholds: CircuitBreakerThresholds = {
    maxCpuRate: 0.85,
    maxDeficitRate: 5.0,
    maxEventLoopLagMs: 150,
    maxHeapMb: 1500,
    maxDbFailures: 3,
  };

  test('정상 수치일 때 차단되지 않음', () => {
    const cb = new CircuitBreaker(defaultThresholds);
    const lavalink: LavalinkMetrics = {
      lavalinkLoad: 0.2, systemLoad: 0.3, usedMemoryMb: 500, allocatedMemoryMb: 1000,
      reservableMemoryMb: 2000, activePlayers: 20, sentFrames: 1000, nulledFrames: 0,
      deficitFrames: 0, deficitRate: 0,
    };
    const node: NodeMetrics = {
      eventLoopLagMeanMs: 5, eventLoopLagP95Ms: 10, eventLoopLagMaxMs: 20,
      heapUsedMb: 200, heapTotalMb: 400, rssMb: 500,
    };
    const db: DbMetrics = { insertLatencyMeanMs: 10, insertLatencyP95Ms: 20, totalInserts: 20, failedInserts: 0 };

    const check = cb.evaluate(lavalink, node, db);
    assert.strictEqual(check.shouldAbort, false);
  });

  test('Lavalink CPU 85% 초과 시 비상 중단 트리거', () => {
    const cb = new CircuitBreaker(defaultThresholds);
    const lavalink: any = { systemLoad: 0.88, deficitRate: 0 };
    const node: any = { eventLoopLagP95Ms: 10, heapUsedMb: 200 };
    const db: any = { failedInserts: 0 };

    const check = cb.evaluate(lavalink, node, db);
    assert.strictEqual(check.shouldAbort, true);
    assert.ok(check.reason?.includes('CPU'));
  });

  test('프레임 결손 5% 초과 시 비상 중단 트리거', () => {
    const cb = new CircuitBreaker(defaultThresholds);
    const lavalink: any = { systemLoad: 0.5, deficitRate: 6.2 };
    const node: any = { eventLoopLagP95Ms: 10, heapUsedMb: 200 };
    const db: any = { failedInserts: 0 };

    const check = cb.evaluate(lavalink, node, db);
    assert.strictEqual(check.shouldAbort, true);
    assert.ok(check.reason?.includes('프레임 결손'));
  });

  test('Node.js 이벤트 루프 지연 150ms 초과 시 비상 중단 트리거', () => {
    const cb = new CircuitBreaker(defaultThresholds);
    const lavalink: any = { systemLoad: 0.3, deficitRate: 0 };
    const node: any = { eventLoopLagP95Ms: 180, heapUsedMb: 200 };
    const db: any = { failedInserts: 0 };

    const check = cb.evaluate(lavalink, node, db);
    assert.strictEqual(check.shouldAbort, true);
    assert.ok(check.reason?.includes('이벤트 루프'));
  });
});
