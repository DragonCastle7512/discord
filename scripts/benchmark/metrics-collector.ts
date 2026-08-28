import { monitorEventLoopDelay, IntervalHistogram } from 'node:perf_hooks';
import { LavalinkMetrics, NodeMetrics, DbMetrics } from './types';

export class MetricsCollector {
  private histogram: IntervalHistogram | null = null;
  private dbLatencies: number[] = [];
  private dbFailures: number = 0;

  start(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
    this.dbLatencies = [];
    this.dbFailures = 0;
  }

  stop(): void {
    if (this.histogram) {
      this.histogram.disable();
    }
  }

  recordDbLatency(latencyMs: number, success: boolean): void {
    if (success) {
      this.dbLatencies.push(latencyMs);
    } else {
      this.dbFailures++;
    }
  }

  getNodeMetrics(): NodeMetrics {
    const mem = process.memoryUsage();
    let meanMs = 0;
    let p95Ms = 0;
    let maxMs = 0;

    if (this.histogram) {
      const mean = this.histogram.mean;
      const p95 = this.histogram.percentile(95);
      const max = this.histogram.max;

      // When no event loop delay has been recorded, value might be NaN or 0
      meanMs = isNaN(mean) ? 0 : mean / 1e6;
      p95Ms = isNaN(p95) ? 0 : p95 / 1e6;
      maxMs = isNaN(max) ? 0 : max / 1e6;
    }

    return {
      eventLoopLagMeanMs: Number(meanMs.toFixed(2)),
      eventLoopLagP95Ms: Number(p95Ms.toFixed(2)),
      eventLoopLagMaxMs: Number(maxMs.toFixed(2)),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    };
  }

  parseLavalinkStats(stats: any): LavalinkMetrics {
    const frames = stats?.frameStats || { sent: 0, nulled: 0, deficit: 0 };
    const totalFrames = (frames.sent || 0) + (frames.deficit || 0);
    const deficitRate = totalFrames > 0 ? ((frames.deficit || 0) / totalFrames) * 100 : 0;

    return {
      lavalinkLoad: stats?.cpu?.lavalinkLoad || 0,
      systemLoad: stats?.cpu?.systemLoad || 0,
      usedMemoryMb: Math.round((stats?.memory?.used || 0) / 1024 / 1024),
      allocatedMemoryMb: Math.round((stats?.memory?.allocated || 0) / 1024 / 1024),
      reservableMemoryMb: Math.round((stats?.memory?.reservable || 0) / 1024 / 1024),
      activePlayers: stats?.playingPlayers || stats?.players || 0,
      sentFrames: frames.sent || 0,
      nulledFrames: frames.nulled || 0,
      deficitFrames: frames.deficit || 0,
      deficitRate: Number(deficitRate.toFixed(2)),
    };
  }

  getDbMetrics(): DbMetrics {
    const sorted = [...this.dbLatencies].sort((a, b) => a - b);
    const count = sorted.length;
    const mean = count > 0 ? sorted.reduce((sum, v) => sum + v, 0) / count : 0;
    const p95 = count > 0 ? sorted[Math.floor(count * 0.95)] : 0;

    return {
      insertLatencyMeanMs: Number(mean.toFixed(2)),
      insertLatencyP95Ms: Number(p95.toFixed(2)),
      totalInserts: count + this.dbFailures,
      failedInserts: this.dbFailures,
    };
  }
}
