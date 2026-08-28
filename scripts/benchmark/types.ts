export interface BenchmarkStage {
  name: string;
  guildCount: number;
  holdSeconds: number;
}

export interface LavalinkMetrics {
  lavalinkLoad: number; // 0.0 ~ 1.0
  systemLoad: number;   // 0.0 ~ 1.0
  usedMemoryMb: number;
  allocatedMemoryMb: number;
  reservableMemoryMb: number;
  activePlayers: number;
  sentFrames: number;
  nulledFrames: number;
  deficitFrames: number;
  deficitRate: number; // percentage (0 ~ 100)
}

export interface NodeMetrics {
  eventLoopLagMeanMs: number;
  eventLoopLagP95Ms: number;
  eventLoopLagMaxMs: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
}

export interface DbMetrics {
  insertLatencyMeanMs: number;
  insertLatencyP95Ms: number;
  totalInserts: number;
  failedInserts: number;
}

export interface StageReport {
  stage: BenchmarkStage;
  lavalink: LavalinkMetrics;
  node: NodeMetrics;
  db: DbMetrics;
  passed: boolean;
  abortReason?: string;
}

export interface CircuitBreakerThresholds {
  maxCpuRate: number;        // default: 0.85 (85%)
  maxDeficitRate: number;    // default: 5.0 (5%)
  maxEventLoopLagMs: number; // default: 150 (ms)
  maxHeapMb: number;         // default: 1500 (MB)
  maxDbFailures: number;     // default: 3
}

export interface BenchmarkConfig {
  stages: BenchmarkStage[];
  cooldownSeconds: number;
  thresholds: CircuitBreakerThresholds;
  targetSpecs: {
    ocpu: number;
    memoryGb: number;
    bandwidthGbps: number;
  };
}
