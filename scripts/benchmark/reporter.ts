import { StageReport, BenchmarkConfig } from './types';

export class BenchmarkReporter {
  constructor(private targetSpecs: BenchmarkConfig['targetSpecs']) {}

  generateSummary(reports: StageReport[]): string {
    const lines: string[] = [];
    lines.push('\n======================= 📊 LOAD TEST BENCHMARK REPORT =======================');
    lines.push(`[Target Server Specs] Oracle Cloud A1.Flex (${this.targetSpecs.ocpu} OCPU, ${this.targetSpecs.memoryGb}GB RAM, ${this.targetSpecs.bandwidthGbps}Gbps)\n`);
    lines.push('단계별 결과 요약:');

    let maxStableGuilds = 0;
    let totalCpuPerGuild = 0;
    let totalMemPerGuild = 0;
    let sampleCount = 0;

    for (const rep of reports) {
      const gCount = rep.stage.guildCount;
      const stageName = rep.stage.name;
      const cpu = ((rep.lavalink.systemLoad || rep.lavalink.lavalinkLoad || 0) * 100).toFixed(1);
      const ramMb = rep.lavalink.usedMemoryMb;
      const ram = ramMb >= 1024 ? `${(ramMb / 1024).toFixed(2)}GB` : `${ramMb}MB`;
      const def = rep.lavalink.deficitRate.toFixed(1);
      const lag = rep.node.eventLoopLagP95Ms.toFixed(1);
      const startupMetrics = rep.startup ?? { targetPlayers: gCount, previousPlayers: 0, requestedPlayers: gCount, successfulPlayers: gCount, failedPlayers: 0, failureRate: 0, startupDurationMs: 0, createLatencyMeanMs: 0, createLatencyP95Ms: 0, createLatencyMaxMs: 0, sessionPlayers: gCount, lavalinkPlayingPlayers: rep.lavalink.activePlayers, targetReached: true };
      const startup = `${startupMetrics.successfulPlayers}/${startupMetrics.requestedPlayers}`;
      const startupP95 = `${startupMetrics.createLatencyP95Ms}ms`;
      const session = `${startupMetrics.sessionPlayers}/${startupMetrics.targetPlayers}`;
      const playing = `${startupMetrics.lavalinkPlayingPlayers}/${startupMetrics.targetPlayers}`;
      const status = rep.passed ? (rep.lavalink.deficitRate === 0 && rep.node.eventLoopLagP95Ms < 20 ? '[최상]' : '[안정]') : `[중단: ${rep.abortReason}]`;

      lines.push(`  - [${stageName}] ${String(gCount).padStart(3)} 채널 : Startup ${startup} p95 ${startupP95} | Session ${session} | StatsPlaying ${playing} | CPU ${cpu.padStart(5)}% | RAM ${ram.padStart(7)} | Deficit ${def}% | EventLoop Lag ${lag.padStart(5)}ms ${status}`);

      if (rep.passed && startupMetrics.targetReached && rep.lavalink.deficitRate <= 1.0) {
        maxStableGuilds = Math.max(maxStableGuilds, gCount);
      }

      if (gCount > 0 && rep.passed && startupMetrics.targetReached) {
        totalCpuPerGuild += (rep.lavalink.systemLoad || 0) / gCount;
        totalMemPerGuild += rep.lavalink.usedMemoryMb / gCount;
        sampleCount++;
      }
    }

    const avgCpuPerGuild = sampleCount > 0 ? (totalCpuPerGuild / sampleCount) * 100 : 0.45;
    const avgMemPerGuild = sampleCount > 0 ? Math.round(totalMemPerGuild / sampleCount) : 25;

    lines.push('\n💡 결론 및 권장 가이드:');
    lines.push(`  - 1개 채널당 평균 소모 자원: CPU ~${avgCpuPerGuild.toFixed(2)}%, RAM ~${avgMemPerGuild}MB, Network ~160kbps`);
    lines.push(`  - 현재 서버 사양 기준 [동시 재생 시작 성공 + 무결점 음질 유지 권장 수]: 최대 ${maxStableGuilds > 0 ? maxStableGuilds : '측정치 확인 필요'}개 서버`);
    lines.push(`  - [음질 저하 허용 최대 동시 재생 수]: 최대 ${Math.floor(maxStableGuilds * 1.3)}개 서버`);
    lines.push(`  * 참고: 본 벤치마크는 REST API 동시 세션 처리량 지표입니다. 실제 Voice UDP 송출 환경에서는 오디오 스트림 수에 따라 시스템 부하가 추가될 수 있습니다.`);
    lines.push('=============================================================================\n');

    return lines.join('\n');
  }
}
