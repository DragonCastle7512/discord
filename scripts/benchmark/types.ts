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

export interface StartupMetrics {
  targetPlayers: number;
  previousPlayers: number;
  requestedPlayers: number;
  successfulPlayers: number;
  failedPlayers: number;
  failureRate: number; // 0.0 ~ 1.0
  startupDurationMs: number;
  createLatencyMeanMs: number;
  createLatencyP95Ms: number;
  createLatencyMaxMs: number;
  sessionPlayers: number;
  lavalinkPlayingPlayers: number;
  targetReached: boolean;
}

export interface StageReport {
  stage: BenchmarkStage;
  startup?: StartupMetrics;
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
  maxStartupFailureRate?: number; // default: 0.02 (2%)
  minPlayingPlayersRatio?: number; // default: 0.98 (98%)
}

export interface BenchmarkConfig {
  stages: BenchmarkStage[];
  cooldownSeconds: number;
  startupConcurrency?: number;
  statsFreshnessMs?: number;
  thresholds: CircuitBreakerThresholds;
  targetSpecs: {
    ocpu: number;
    memoryGb: number;
    bandwidthGbps: number;
  };
}
