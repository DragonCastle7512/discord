import { CircuitBreakerThresholds, LavalinkMetrics, NodeMetrics, DbMetrics } from './types';

export interface EvaluationResult {
  shouldAbort: boolean;
  reason?: string;
}

export class CircuitBreaker {
  constructor(private thresholds: CircuitBreakerThresholds) {}

  evaluate(lavalink: LavalinkMetrics, node: NodeMetrics, db: DbMetrics): EvaluationResult {
    // 1. CPU 검사
    const maxCpu = Math.max(lavalink.lavalinkLoad || 0, lavalink.systemLoad || 0);
    if (maxCpu >= this.thresholds.maxCpuRate) {
      return {
        shouldAbort: true,
        reason: `CPU 사용률 위험 한계치 도달 (${(maxCpu * 100).toFixed(1)}% >= ${(this.thresholds.maxCpuRate * 100).toFixed(1)}%)`,
      };
    }

    // 2. 오디오 프레임 결손율 검사
    if (lavalink.deficitRate >= this.thresholds.maxDeficitRate) {
      return {
        shouldAbort: true,
        reason: `오디오 프레임 결손(음질 저하) 위험 한계치 도달 (${lavalink.deficitRate.toFixed(1)}% >= ${this.thresholds.maxDeficitRate.toFixed(1)}%)`,
      };
    }

    // 3. Node.js 이벤트 루프 지연 검사
    if (node.eventLoopLagP95Ms >= this.thresholds.maxEventLoopLagMs) {
      return {
        shouldAbort: true,
        reason: `Node.js 이벤트 루프 지연 위험 한계치 도달 (p95 ${node.eventLoopLagP95Ms}ms >= ${this.thresholds.maxEventLoopLagMs}ms)`,
      };
    }

    // 4. Node.js 메모리 검사
    if (node.heapUsedMb >= this.thresholds.maxHeapMb) {
      return {
        shouldAbort: true,
        reason: `Node.js 힙 메모리 한계치 도달 (${node.heapUsedMb}MB >= ${this.thresholds.maxHeapMb}MB)`,
      };
    }

    // 5. DB 실패 횟수 검사
    if (db.failedInserts >= this.thresholds.maxDbFailures) {
      return {
        shouldAbort: true,
        reason: `DB 연속 쿼리 실패 한계치 도달 (${db.failedInserts}회 >= ${this.thresholds.maxDbFailures}회)`,
      };
    }

    return { shouldAbort: false };
  }
}
