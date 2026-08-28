import { test, describe } from 'node:test';
import assert from 'node:assert';
import { BenchmarkStage, LavalinkMetrics, NodeMetrics, DbMetrics, StageReport, BenchmarkConfig } from '../../scripts/benchmark/types';

describe('Benchmark Types', () => {
  test('BenchmarkStage structure validation', () => {
    const stage: BenchmarkStage = {
      name: 'Stage 1 (Normal)',
      guildCount: 20,
      holdSeconds: 30,
    };
    assert.strictEqual(stage.guildCount, 20);
    assert.strictEqual(stage.holdSeconds, 30);
  });

  test('BenchmarkConfig structure validation', () => {
    const config: BenchmarkConfig = {
      stages: [
        { name: 'Warm-up', guildCount: 5, holdSeconds: 15 },
        { name: 'Stage 1', guildCount: 20, holdSeconds: 30 },
      ],
      cooldownSeconds: 5,
      thresholds: {
        maxCpuRate: 0.85,
        maxDeficitRate: 5.0,
        maxEventLoopLagMs: 150,
        maxHeapMb: 1500,
        maxDbFailures: 3,
      },
      targetSpecs: {
        ocpu: 4,
        memoryGb: 24,
        bandwidthGbps: 4,
      },
    };

    assert.strictEqual(config.stages.length, 2);
    assert.strictEqual(config.targetSpecs.ocpu, 4);
    assert.strictEqual(config.thresholds.maxCpuRate, 0.85);
  });
});
