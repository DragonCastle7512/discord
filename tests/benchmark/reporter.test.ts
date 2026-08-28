import { test, describe } from 'node:test';
import assert from 'node:assert';
import { BenchmarkReporter } from '../../scripts/benchmark/reporter';
import { StageReport } from '../../scripts/benchmark/types';

describe('BenchmarkReporter', () => {
  test('리포트 요약 및 권장 수용량 계산 정상 출력', () => {
    const reporter = new BenchmarkReporter({ ocpu: 4, memoryGb: 24, bandwidthGbps: 4 });
    const reports: StageReport[] = [
      {
        stage: { name: 'Stage 1', guildCount: 20, holdSeconds: 30 },
        lavalink: {
          lavalinkLoad: 0.08, systemLoad: 0.10, usedMemoryMb: 500, allocatedMemoryMb: 1000,
          reservableMemoryMb: 2000, activePlayers: 20, sentFrames: 1000, nulledFrames: 0,
          deficitFrames: 0, deficitRate: 0,
        },
        node: {
          eventLoopLagMeanMs: 2, eventLoopLagP95Ms: 4, eventLoopLagMaxMs: 10,
          heapUsedMb: 200, heapTotalMb: 400, rssMb: 500,
        },
        db: {
          insertLatencyMeanMs: 5, insertLatencyP95Ms: 10, totalInserts: 20, failedInserts: 0,
        },
        passed: true,
      },
    ];

    const output = reporter.generateSummary(reports);
    assert.ok(output.includes('LOAD TEST BENCHMARK REPORT'));
    assert.ok(output.includes('Oracle Cloud'));
    assert.ok(output.includes('Stage 1'));
    assert.ok(output.includes('20 채널'));
  });

  test('중단된 단계에 대한 리포트 출력 표시', () => {
    const reporter = new BenchmarkReporter({ ocpu: 4, memoryGb: 24, bandwidthGbps: 4 });
    const reports: StageReport[] = [
      {
        stage: { name: 'Stage 4', guildCount: 200, holdSeconds: 45 },
        lavalink: {
          lavalinkLoad: 0.85, systemLoad: 0.90, usedMemoryMb: 4000, allocatedMemoryMb: 5000,
          reservableMemoryMb: 8000, activePlayers: 200, sentFrames: 1000, nulledFrames: 10,
          deficitFrames: 80, deficitRate: 7.4,
        },
        node: {
          eventLoopLagMeanMs: 50, eventLoopLagP95Ms: 160, eventLoopLagMaxMs: 300,
          heapUsedMb: 800, heapTotalMb: 1200, rssMb: 1400,
        },
        db: {
          insertLatencyMeanMs: 30, insertLatencyP95Ms: 90, totalInserts: 200, failedInserts: 0,
        },
        passed: false,
        abortReason: 'CPU 위험 한계치 도달',
      },
    ];

    const output = reporter.generateSummary(reports);
    assert.ok(output.includes('중단: CPU 위험 한계치 도달'));
  });
});
