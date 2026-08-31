import { MetricsCollector } from './metrics-collector';
import { CircuitBreaker } from './circuit-breaker';
import { VirtualGuildManager } from './virtual-guild-manager';
import { BenchmarkReporter } from './reporter';
import { BenchmarkConfig, StageReport, StartupMetrics } from './types';
import { insertHistory } from '../../music/repositorys/music-history.repository';
import { initDb } from '../../db/init';

const LAVALINK_HOST = process.env.LAVALINK_HOST || 'localhost';
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT || 2333);
const LAVALINK_PASSWORD = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === 'true';

const httpProto = LAVALINK_SECURE ? 'https' : 'http';
const wsProto = LAVALINK_SECURE ? 'wss' : 'ws';
const baseUrl = `${httpProto}://${LAVALINK_HOST}:${LAVALINK_PORT}`;
const wsUrl = `${wsProto}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/websocket`;

type AxiosClient = {
  get: (url: string, config?: unknown) => Promise<{ data: any }>;
  patch: (url: string, data?: unknown, config?: unknown) => Promise<unknown>;
  delete: (url: string, config?: unknown) => Promise<unknown>;
};
let axiosClient: AxiosClient | null = null;

async function getAxios(): Promise<AxiosClient> {
  if (!axiosClient) {
    axiosClient = (await import('axios')).default as unknown as AxiosClient;
  }
  return axiosClient!;
}

const config: BenchmarkConfig = {
  stages: [
    { name: 'Warm-up', guildCount: 5, holdSeconds: 15 },
    { name: 'Stage 1 (일상 부하)', guildCount: 20, holdSeconds: 30 },
    { name: 'Stage 2 (중간 부하)', guildCount: 50, holdSeconds: 30 },
    { name: 'Stage 3 (고부하)', guildCount: 100, holdSeconds: 45 },
    { name: 'Stage 4 (한계 부하)', guildCount: 150, holdSeconds: 45 },
  ],
  cooldownSeconds: 5,
  startupConcurrency: Number(process.env.BENCHMARK_STARTUP_CONCURRENCY || 25),
  statsFreshnessMs: Number(process.env.BENCHMARK_STATS_FRESHNESS_MS || 5000),
  thresholds: {
    maxCpuRate: 0.85,
    maxDeficitRate: 5.0,
    maxEventLoopLagMs: 150,
    maxHeapMb: 1500,
    maxDbFailures: 3,
    maxStartupFailureRate: 0.02,
    minPlayingPlayersRatio: 0.98,
  },
  targetSpecs: {
    ocpu: 4,
    memoryGb: 24,
    bandwidthGbps: 4,
  },
};

const vgm = new VirtualGuildManager();
const collector = new MetricsCollector();
const circuitBreaker = new CircuitBreaker(config.thresholds);
const reporter = new BenchmarkReporter(config.targetSpecs);

let sessionId: string | null = null;
let latestStats: any = null;
let latestStatsAt = 0;
let activePlayerGuildIds = new Set<string>();
let isShuttingDown = false;
let isDbReady = false;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function destroyAllPlayers() {
  if (!sessionId) return;
  const ids = Array.from(activePlayerGuildIds);
  console.log(`\n🧹 [Cleanup] 활성화된 ${ids.length}개 가상 플레이어 세션 정리 중...`);
  await mapWithConcurrency(ids, 20, async (guildId) => {
    try {
      await (await getAxios()).delete(`${baseUrl}/v4/sessions/${sessionId}/players/${guildId}`, {
        headers: { Authorization: LAVALINK_PASSWORD },
        timeout: 3000,
      });
    } catch {
      // 무시
    }
  });
  activePlayerGuildIds.clear();
  vgm.clear();
  console.log('✅ [Cleanup] 모든 세션 정리 완료.');
}

async function setupLavalinkWs(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Lavalink WebSocket 연결 시간 초과 (10초)'));
    }, 10000);

    const ws = new (globalThis as any).WebSocket(wsUrl, {
      headers: {
        Authorization: LAVALINK_PASSWORD,
        'User-Id': '123456789012345678',
        'Client-Name': 'ChisaBot-Benchmark/1.0',
      },
    });

    ws.onmessage = (event: any) => {
      try {
        const data = JSON.parse(event.data.toString());
        if (data.op === 'ready') {
          clearTimeout(timeout);
          sessionId = data.sessionId;
          console.log(`🔗 [Lavalink] 연결 완료 (Session ID: ${sessionId})`);
          resolve(data.sessionId);
        } else if (data.op === 'stats') {
          latestStats = data;
          latestStatsAt = Date.now();
        }
      } catch (err) {
        console.error('Lavalink WS 메시지 파싱 오류:', err);
      }
    };

    ws.onerror = (err: any) => {
      clearTimeout(timeout);
      reject(err);
    };

    ws.onclose = () => {
      if (!isShuttingDown) {
        console.log('⚠️ [Lavalink] WebSocket 연결이 종료되었습니다.');
      }
    };
  });
}

async function loadTestTrack(): Promise<{ encoded: string; info: any }> {
  console.log('🔍 [Lavalink] 테스트용 트랙 로딩 중 (scsearch:lofi)...');
  const response = await (await getAxios()).get(`${baseUrl}/v4/loadtracks`, {
    params: { identifier: 'scsearch:lofi' },
    headers: { Authorization: LAVALINK_PASSWORD },
    timeout: 10000,
  });

  const data = response.data;
  let track = null;
  if (data.loadType === 'search' && data.data?.length > 0) {
    track = data.data[0];
  } else if (data.loadType === 'track') {
    track = data.data;
  }

  if (!track) {
    throw new Error('테스트용 트랙을 찾을 수 없습니다.');
  }

  console.log(`🎵 [Lavalink] 테스트 트랙 준비 완료: ${track.info.title} (${track.info.author})`);
  return { encoded: track.encoded, info: track.info };
}

async function fetchLavalinkStats(): Promise<any> {
  try {
    const response = await (await getAxios()).get(`${baseUrl}/v4/stats`, {
      headers: { Authorization: LAVALINK_PASSWORD },
      timeout: 3000,
    });
    if (response.data) {
      latestStats = response.data;
      latestStatsAt = Date.now();
      return response.data;
    }
  } catch {
    // REST 조회가 실패하면 기존 WS stats 유지
  }
  return latestStats;
}

async function waitForFreshStats(timeoutMs = 5000): Promise<boolean> {
  await fetchLavalinkStats();
  if (latestStats && Date.now() - latestStatsAt <= (config.statsFreshnessMs ?? 5000)) {
    return true;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await fetchLavalinkStats();
    if (latestStats && Date.now() - latestStatsAt <= (config.statsFreshnessMs ?? 5000)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function getSessionPlayerStats(): Promise<{ sessionPlayers: number; activeTrackPlayers: number }> {
  if (!sessionId) {
    return { sessionPlayers: activePlayerGuildIds.size, activeTrackPlayers: activePlayerGuildIds.size };
  }
  try {
    const response = await (await getAxios()).get(`${baseUrl}/v4/sessions/${sessionId}/players`, {
      headers: { Authorization: LAVALINK_PASSWORD },
      timeout: 5000,
    });
    const data = response.data;
    const players = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const activeTrackPlayers = players.filter((p: any) => p.track && !p.paused).length;
    return {
      sessionPlayers: players.length,
      activeTrackPlayers: Math.max(activeTrackPlayers, players.length),
    };
  } catch (err: any) {
    const errorDetail = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
    console.warn(`\n⚠️ [Session] Lavalink player 목록 조회 실패: ${errorDetail}`);
  }
  return { sessionPlayers: activePlayerGuildIds.size, activeTrackPlayers: activePlayerGuildIds.size };
}

async function getSessionPlayerCount(): Promise<number> {
  const { sessionPlayers } = await getSessionPlayerStats();
  return sessionPlayers;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));

  return results;
}

async function createPlaybackLoad(
  stage: typeof config.stages[0],
  track: { encoded: string; info: any }
): Promise<StartupMetrics> {
  const previousPlayers = activePlayerGuildIds.size;
  const requestedPlayers = Math.max(0, stage.guildCount - previousPlayers);
  const startupStartedAt = Date.now();

  if (requestedPlayers === 0) {
    await waitForFreshStats();
    const { sessionPlayers, activeTrackPlayers } = await getSessionPlayerStats();
    const rawLavalink = collector.parseLavalinkStats(latestStats);
    const effectivePlayingPlayers = Math.max(rawLavalink.activePlayers, activeTrackPlayers);
    return {
      targetPlayers: stage.guildCount,
      previousPlayers,
      requestedPlayers,
      successfulPlayers: 0,
      failedPlayers: 0,
      failureRate: 0,
      startupDurationMs: 0,
      createLatencyMeanMs: 0,
      createLatencyP95Ms: 0,
      createLatencyMaxMs: 0,
      sessionPlayers,
      lavalinkPlayingPlayers: effectivePlayingPlayers,
      targetReached: effectivePlayingPlayers >= Math.ceil(stage.guildCount * (config.thresholds.minPlayingPlayersRatio ?? 0.98)),
    };
  }

  const startupConcurrency = config.startupConcurrency ?? 25;
  console.log(`➕ [Player] ${requestedPlayers}개의 신규 가상 플레이어를 동시 시작합니다. concurrency=${startupConcurrency}`);

  const guilds = Array.from({ length: requestedPlayers }, (_, offset) =>
    vgm.createVirtualGuild(previousPlayers + offset + 1)
  );

  const dbWrites: Promise<void>[] = [];
  const results = await mapWithConcurrency(guilds, startupConcurrency, async (guild) => {
    const requestStartedAt = Date.now();
    try {
      await (await getAxios()).patch(
        `${baseUrl}/v4/sessions/${sessionId}/players/${guild.id}`,
        {
          track: { encoded: track.encoded },
          paused: false,
          volume: 100,
        },
        {
          headers: { Authorization: LAVALINK_PASSWORD },
          timeout: 5000,
        }
      );

      activePlayerGuildIds.add(guild.id);

      if (isDbReady) {
        const dbStartedAt = Date.now();
        const mockTrack: any = {
          encoded: track.encoded,
          info: track.info || {},
          requestedBy: 'mock-bench-user',
          tags: [],
        };
        dbWrites.push(
          insertHistory(guild.id, mockTrack)
            .then(() => collector.recordDbLatency(Date.now() - dbStartedAt, true))
            .catch(() => collector.recordDbLatency(Date.now() - dbStartedAt, false))
        );
      }

      return { ok: true, latencyMs: Date.now() - requestStartedAt };
    } catch (err: any) {
      const errorDetail = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
      console.error(`\n가상 플레이어 ${guild.id} 생성 실패: ${errorDetail}`);
      vgm.removeGuild(guild.id);
      return { ok: false, latencyMs: Date.now() - requestStartedAt };
    }
  });

  await Promise.allSettled(dbWrites);
  const hasFreshStats = await waitForFreshStats();
  if (!hasFreshStats) {
    console.warn('\n⚠️ [Stats] 최신 Lavalink stats를 제한 시간 안에 받지 못했습니다. 목표 도달 판정이 보수적으로 실패할 수 있습니다.');
  }

  const { sessionPlayers, activeTrackPlayers } = await getSessionPlayerStats();
  const latencies = results.map((result) => result.latencyMs);
  const successfulPlayers = results.filter((result) => result.ok).length;
  const failedPlayers = requestedPlayers - successfulPlayers;
  const rawLavalink = collector.parseLavalinkStats(latestStats);
  const effectivePlayingPlayers = Math.max(rawLavalink.activePlayers, activeTrackPlayers);
  const targetPlayingPlayers = Math.ceil(stage.guildCount * (config.thresholds.minPlayingPlayersRatio ?? 0.98));

  return {
    targetPlayers: stage.guildCount,
    previousPlayers,
    requestedPlayers,
    successfulPlayers,
    failedPlayers,
    failureRate: requestedPlayers > 0 ? failedPlayers / requestedPlayers : 0,
    startupDurationMs: Date.now() - startupStartedAt,
    createLatencyMeanMs: Number((latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length)).toFixed(2)),
    createLatencyP95Ms: percentile(latencies, 0.95),
    createLatencyMaxMs: Math.max(0, ...latencies),
    sessionPlayers,
    lavalinkPlayingPlayers: effectivePlayingPlayers,
    targetReached: effectivePlayingPlayers >= targetPlayingPlayers,
  };
}

async function runStage(
  stage: typeof config.stages[0],
  track: { encoded: string; info: any }
): Promise<StageReport> {
  console.log(`\n============================================================`);
  console.log(`🚀 [시작] ${stage.name} - 목표 가상 길드 수: ${stage.guildCount}개 (유지 시간: ${stage.holdSeconds}초)`);
  console.log(`============================================================`);

  collector.start();

  const startup = await createPlaybackLoad(stage, track);
  console.log(
    `✅ [Startup] 요청 ${startup.requestedPlayers}개, 성공 ${startup.successfulPlayers}개, 실패 ${startup.failedPlayers}개, ` +
    `p95 ${startup.createLatencyP95Ms}ms, Session ${startup.sessionPlayers}/${startup.targetPlayers}, StatsPlaying ${startup.lavalinkPlayingPlayers}/${startup.targetPlayers}`
  );

  // 유지 시간 동안 메트릭 감시 및 CircuitBreaker 검사
  const intervalMs = 1500;
  const loops = Math.floor((stage.holdSeconds * 1000) / intervalMs);
  let abortReason: string | undefined;

  for (let l = 0; l < loops; l++) {
    await sleep(intervalMs);
    await fetchLavalinkStats();
    const { sessionPlayers, activeTrackPlayers } = await getSessionPlayerStats();

    const rawLavalink = collector.parseLavalinkStats(latestStats);
    const effectivePlayingPlayers = Math.max(rawLavalink.activePlayers, activeTrackPlayers);
    const lavalinkMetrics = { ...rawLavalink, activePlayers: effectivePlayingPlayers };

    const nodeMetrics = collector.getNodeMetrics();
    const dbMetrics = collector.getDbMetrics();

    const currentStartup = {
      ...startup,
      sessionPlayers,
      lavalinkPlayingPlayers: lavalinkMetrics.activePlayers,
      targetReached: lavalinkMetrics.activePlayers >= Math.ceil(stage.guildCount * (config.thresholds.minPlayingPlayersRatio ?? 0.98)),
    };
    const evaluation = circuitBreaker.evaluate(lavalinkMetrics, nodeMetrics, dbMetrics, currentStartup);

    const cpuText = `${((lavalinkMetrics.systemLoad || 0) * 100).toFixed(1)}%`;
    const ramText = lavalinkMetrics.usedMemoryMb >= 1024 ? `${(lavalinkMetrics.usedMemoryMb / 1024).toFixed(2)}GB` : `${lavalinkMetrics.usedMemoryMb}MB`;
    const defText = `${lavalinkMetrics.deficitRate.toFixed(1)}%`;
    const lagText = `${nodeMetrics.eventLoopLagP95Ms}ms`;

    process.stdout.write(
      `\r📊 [${stage.name}] [${l + 1}/${loops}] 활성: ${activePlayerGuildIds.size}채널 | Session: ${currentStartup.sessionPlayers}/${startup.targetPlayers} | StatsPlaying: ${lavalinkMetrics.activePlayers}/${startup.targetPlayers} | CPU: ${cpuText} | RAM: ${ramText} | 결손: ${defText} | Lag: ${lagText}   `
    );

    if (evaluation.shouldAbort) {
      abortReason = evaluation.reason;
      console.log(`\n🚨 [CircuitBreaker 트리거] ${abortReason}`);
      break;
    }
  }

  console.log('');
  await fetchLavalinkStats();
  const { sessionPlayers: finalSessionPlayers, activeTrackPlayers: finalActiveTrackPlayers } = await getSessionPlayerStats();
  const rawFinalLavalink = collector.parseLavalinkStats(latestStats);
  const finalLavalink = { ...rawFinalLavalink, activePlayers: Math.max(rawFinalLavalink.activePlayers, finalActiveTrackPlayers) };
  const finalNode = collector.getNodeMetrics();
  const finalDb = collector.getDbMetrics();
  collector.stop();

  const finalStartup = {
    ...startup,
    sessionPlayers: finalSessionPlayers,
    lavalinkPlayingPlayers: finalLavalink.activePlayers,
    targetReached: finalLavalink.activePlayers >= Math.ceil(stage.guildCount * (config.thresholds.minPlayingPlayersRatio ?? 0.98)),
  };
  const passed = !abortReason;
  return {
    stage,
    startup: finalStartup,
    lavalink: finalLavalink,
    node: finalNode,
    db: finalDb,
    passed,
    abortReason,
  };
}

async function main() {
  console.log(`=============================================================`);
  console.log(`🎵 ChisaBot 음악 동시 재생 부하 테스트 & 벤치마크 시스템 🎵`);
  console.log(`서버 사양 기준: Oracle Cloud A1.Flex (4 OCPU, 24GB RAM, 4Gbps)`);
  console.log(`동시 시작 concurrency: ${config.startupConcurrency ?? 25}`);
  console.log(`=============================================================`);

  const handleExit = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n🛑 테스트 강제 종료 신호 수신됨.');
    await destroyAllPlayers();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  try {
    // 1. DB 초기화 시도
    try {
      await initDb();
      isDbReady = true;
      console.log('📦 [DB] 데이터베이스 연결 및 모델 초기화 완료');
    } catch {
      console.log('ℹ️ [DB] 데이터베이스 연결 생략 (Lavalink 동시 재생 벤치마크 모드로 진행)');
    }

    // 2. Lavalink WebSocket 연결 및 트랙 로드
    await setupLavalinkWs();
    const statsReady = await waitForFreshStats();
    if (!statsReady) {
      console.log('ℹ️ [Stats] 초기 stats 수신 전입니다. 첫 stage에서 다시 확인합니다.');
    }
    const track = await loadTestTrack();

    const stageReports: StageReport[] = [];

    for (const stage of config.stages) {
      const report = await runStage(stage, track);
      stageReports.push(report);

      if (!report.passed) {
        console.log(`\n⚠️ ${stage.name}에서 안전 차단기가 작동하여 후속 단계를 중단합니다.`);
        break;
      }

      console.log(`⏳ [Cooldown] 다음 단계를 위해 ${config.cooldownSeconds}초간 시스템 안정화 대기...`);
      await sleep(config.cooldownSeconds * 1000);
    }

    await destroyAllPlayers();

    const summaryReport = reporter.generateSummary(stageReports);
    console.log(summaryReport);

  } catch (err: any) {
    console.error('\n❌ 벤치마크 실행 중 오류 발생:', err?.message || err);
    await destroyAllPlayers();
    process.exit(1);
  }
}

if (require.main === module || process.argv[1]?.includes('benchmark')) {
  main();
}
