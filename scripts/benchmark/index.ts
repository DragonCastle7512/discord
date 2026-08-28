import axios from 'axios';
import { MetricsCollector } from './metrics-collector';
import { CircuitBreaker } from './circuit-breaker';
import { VirtualGuildManager } from './virtual-guild-manager';
import { BenchmarkReporter } from './reporter';
import { BenchmarkConfig, StageReport } from './types';
import { insertHistory } from '../../music/repositorys/music-history.repository';

const LAVALINK_HOST = process.env.LAVALINK_HOST || 'localhost';
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT || 2333);
const LAVALINK_PASSWORD = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === 'true';

const httpProto = LAVALINK_SECURE ? 'https' : 'http';
const wsProto = LAVALINK_SECURE ? 'wss' : 'ws';
const baseUrl = `${httpProto}://${LAVALINK_HOST}:${LAVALINK_PORT}`;
const wsUrl = `${wsProto}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/websocket`;

const config: BenchmarkConfig = {
  stages: [
    { name: 'Warm-up', guildCount: 5, holdSeconds: 15 },
    { name: 'Stage 1 (일상 부하)', guildCount: 20, holdSeconds: 30 },
    { name: 'Stage 2 (중간 부하)', guildCount: 50, holdSeconds: 30 },
    { name: 'Stage 3 (고부하)', guildCount: 100, holdSeconds: 45 },
    { name: 'Stage 4 (한계 부하)', guildCount: 150, holdSeconds: 45 },
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

const vgm = new VirtualGuildManager();
const collector = new MetricsCollector();
const circuitBreaker = new CircuitBreaker(config.thresholds);
const reporter = new BenchmarkReporter(config.targetSpecs);

let sessionId: string | null = null;
let latestStats: any = null;
let activePlayerGuildIds = new Set<string>();
let isShuttingDown = false;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function destroyAllPlayers() {
  if (!sessionId) return;
  const ids = Array.from(activePlayerGuildIds);
  console.log(`\n🧹 [Cleanup] 활성화된 ${ids.length}개 가상 플레이어 세션 정리 중...`);
  for (const guildId of ids) {
    try {
      await axios.delete(`${baseUrl}/v4/sessions/${sessionId}/players/${guildId}`, {
        headers: { Authorization: LAVALINK_PASSWORD },
        timeout: 3000,
      });
    } catch {
      // 무시
    }
  }
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
  const response = await axios.get(`${baseUrl}/v4/loadtracks`, {
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

async function runStage(
  stage: typeof config.stages[0],
  track: { encoded: string; info: any }
): Promise<StageReport> {
  console.log(`\n============================================================`);
  console.log(`🚀 [시작] ${stage.name} - 목표 가상 길드 수: ${stage.guildCount}개 (유지 시간: ${stage.holdSeconds}초)`);
  console.log(`============================================================`);

  collector.start();

  // 1. 필요한 수만큼 가상 길드 및 플레이어 확장
  const currentCount = activePlayerGuildIds.size;
  const targetCount = stage.guildCount;

  if (targetCount > currentCount) {
    const toAdd = targetCount - currentCount;
    console.log(`➕ [Player] ${toAdd}개의 신규 가상 플레이어 세션 생성 중...`);

    for (let i = currentCount + 1; i <= targetCount; i++) {
      const guild = vgm.createVirtualGuild(i);
      try {
        await axios.patch(
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

        // DB 히스토리 삽입 부하 테스트 (선택적)
        const startTime = Date.now();
        insertHistory(guild.id, 'mock-bench-user', track.info.title, [track.info.author || 'Lofi'], 'scsearch:lofi')
          .then(() => {
            collector.recordDbLatency(Date.now() - startTime, true);
          })
          .catch(() => {
            collector.recordDbLatency(Date.now() - startTime, false);
          });
      } catch (err: any) {
        const errorDetail = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
        console.error(`가상 플레이어 ${guild.id} 생성 실패:`, errorDetail);
      }
    }
  }

  // 2. 유지 시간 동안 메트릭 감시 및 CircuitBreaker 검사
  const intervalMs = 1500;
  const loops = Math.floor((stage.holdSeconds * 1000) / intervalMs);
  let abortReason: string | undefined;

  for (let l = 0; l < loops; l++) {
    await sleep(intervalMs);

    const lavalinkMetrics = collector.parseLavalinkStats(latestStats);
    const nodeMetrics = collector.getNodeMetrics();
    const dbMetrics = collector.getDbMetrics();

    const evaluation = circuitBreaker.evaluate(lavalinkMetrics, nodeMetrics, dbMetrics);

    const cpuText = `${((lavalinkMetrics.systemLoad || 0) * 100).toFixed(1)}%`;
    const ramText = `${(lavalinkMetrics.usedMemoryMb / 1024).toFixed(1)}GB`;
    const defText = `${lavalinkMetrics.deficitRate.toFixed(1)}%`;
    const lagText = `${nodeMetrics.eventLoopLagP95Ms}ms`;

    process.stdout.write(
      `\r📊 [${stage.name}] [${l + 1}/${loops}] 활성: ${activePlayerGuildIds.size}채널 | CPU: ${cpuText} | RAM: ${ramText} | 결손: ${defText} | Lag: ${lagText}   `
    );

    if (evaluation.shouldAbort) {
      abortReason = evaluation.reason;
      console.log(`\n🚨 [CircuitBreaker 트리거] ${abortReason}`);
      break;
    }
  }

  console.log('');
  const finalLavalink = collector.parseLavalinkStats(latestStats);
  const finalNode = collector.getNodeMetrics();
  const finalDb = collector.getDbMetrics();
  collector.stop();

  const passed = !abortReason;
  return {
    stage,
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
    await setupLavalinkWs();
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
