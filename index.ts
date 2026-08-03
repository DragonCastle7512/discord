process.env.TZ = 'Asia/Seoul';
import path from 'node:path';
import { Shoukaku, Connectors } from 'shoukaku';

import { Client, Events, GatewayIntentBits, Collection, Message, Interaction, VoiceState, BaseGuildTextChannel } from 'discord.js';
// @ts-ignore
import express, { Request, Response, Express } from 'express';
import { 
  TtsRuntime,  
  AppContext,
  RuntimeResponse
} from './types';
import { safeReply } from './common/reply-util';
import { GuildState, MusicRuntime, RuntimeUtils } from './music/types';
import { createDashboardRouter } from './routes/dashboard';
import { createSystemRouter } from './routes/system';
import { createTtsRouter } from './routes/tts';
import { createServer } from 'node:http';
import { initSocket } from './common/socket';
import { createRuntimeUtils } from './music/runtime-util';
import { logger } from './common/logger';
import { commandRateLimiter, aiRateLimiter } from './common/rate-limiter';
import { savePlaybackStatesSync } from './music/playback-state-store';
import { restorePlaybackStates } from './music/playback-restorer';

const { talk } = require('./ai/talk');
const { createMusicRuntime } = require('./music/runtime');
const { createTtsRuntime } = require('./tts/runtime');
import { initDb } from './db/init';
const { createTtsHttpStore } = require('./tts/http-store');
const { loadCommandModules, deployCommands } = require('./commands/loader');
const { createSlashCommandInvoker } = require('./commands/slash-command-invoker');

const token: string = process.env.DISCORD_TOKEN || '';
const clientId: string = process.env.CLIENT_ID || '';
const allowSoundCloudFallback: boolean = process.env.ALLOW_SOUNDCLOUD_FALLBACK === 'true';
const lavalinkReadyTimeoutMs: number = Number(process.env.LAVALINK_READY_TIMEOUT_MS || 20000);
const lavalinkHost: string = process.env.LAVALINK_HOST || '';
const lavalinkPort: number = Number(process.env.LAVALINK_PORT || 2333);
const lavalinkPassword: string = process.env.LAVALINK_PASSWORD || '';
const lavalinkSecure: boolean = process.env.LAVALINK_SECURE === 'true';

const httpPort: number = 3000;
const httpHost: string = '0.0.0.0';
const ttsPublicUrl: string = (process.env.TTS_PUBLIC_BASE_URL || `http://localhost:${httpPort}`);
const app: Express = express();
const httpServer = createServer(app);

initSocket(httpServer);

const ttsHttpStore = createTtsHttpStore({
  baseUrl: ttsPublicUrl,
});

if (!token || !lavalinkHost || !lavalinkPassword) {
  logger.error('system', 'Missing essential environment variables.');
  process.exit(1);
}

const lavalinkResumeTimeout: number = Number(process.env.LAVALINK_RESUME_TIMEOUT_SEC || 60);

class MyClient extends Client {
  commands: Collection<string, any> = new Collection();
}

const client = new MyClient({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates,
	],
});

const readyNodes = new Set<string>();

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  [], // 빈 배열로 생성하여 인스턴스 생성 즉시 첫 연결 시도로 인한 비동기 리스너 경쟁 상태 방지
  {
    reconnectTries: 5,
    reconnectInterval: 3000,
    moveOnDisconnect: false,
    resume: true,
    resumeTimeout: lavalinkResumeTimeout,
    resumeByLibrary: true,
  },
);

(client as any).shoukaku = shoukaku;

initDb();

const guildStates = new Map<string, GuildState>();

const runtimeUtils: RuntimeUtils = createRuntimeUtils({
  client,
  shoukaku,
  readyNodes,
  allowSoundCloudFallback,
  lavalinkReadyTimeoutMs,
  guildStates,
});

const music: MusicRuntime = createMusicRuntime({
  guildStates,
  runtimeUtils,
});

const tts: TtsRuntime = createTtsRuntime({ runtimeUtils, ttsHttpStore });

const context: AppContext = { music, tts };

const commandsRoot: string = path.join(__dirname, 'commands');
const { commands: loadedCommands, warnings } = loadCommandModules(commandsRoot);
for (const warning of warnings) {
  console.log(warning);
}

for (const [name, command] of loadedCommands.entries()) {
  client.commands.set(name, command);
}

context.slashCommands = createSlashCommandInvoker({
  commands: client.commands,
  context,
});

app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));
app.use(express.json());
app.use('/', createSystemRouter());
app.use('/tts', createTtsRouter(ttsHttpStore));
app.use('/api', createDashboardRouter(client, guildStates, music));

app.use((req: Request, res: Response) => {
  res.status(404).sendFile(path.join(__dirname, 'public/error/404.html'));
});

httpServer.listen(httpPort, httpHost, () => {
  console.log(`[HTTP] listening on ${httpHost}:${httpPort}`);
});


// 1. Lavalink HTTP REST 헬스체크 함수 (내장 fetch 사용)
async function checkLavalinkHealthy(host: string, port: number, auth: string, secure: boolean): Promise<boolean> {
  const protocol = secure ? 'https' : 'http';
  const url = `${protocol}://${host}:${port}/version`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(2000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

// 2. 헬스체크 통과 대기 후 WebSocket 연결 실행 루프 (지수 백오프)
async function waitAndConnectNode(name: string) {
  let attempts = 0;
  const maxAttempts = 15;
  
  while (attempts < maxAttempts) {
    attempts++;
    const intervalSec = Math.min(Math.round(3 * Math.pow(1.5, attempts - 1)), 60);
    
    console.log(`[Lavalink] Checking health for ${name}... (Attempt ${attempts}/${maxAttempts})`);
    const isHealthy = await checkLavalinkHealthy(lavalinkHost, lavalinkPort, lavalinkPassword, lavalinkSecure);
    
    if (isHealthy) {
      console.log(`[Lavalink] Node ${name} is healthy! Connecting WebSocket...`);
      
      const node = shoukaku.nodes.get(name);
      if (node) {
        try {
          // 좀비 상태(state가 CONNECTED/CONNECTING으로 꼬여서 connect()가 무시되는 현상) 방지
          try {
            (node as any).cleanupWebsocket();
          } catch {}
          (node as any).state = 3; // 3 = DISCONNECTED
          
          await node.connect();
        } catch (err: any) {
          logger.error('system', `[Lavalink] Failed to connect WebSocket for ${name}: ${err.message}`);
        }
      } else {
        shoukaku.addNode({
          name,
          url: `${lavalinkHost}:${lavalinkPort}`,
          auth: lavalinkPassword,
          secure: lavalinkSecure,
        });
      }
      return; // 정상 연결 또는 addNode 추가 후 루프 종료
    }
    
    console.log(`[Lavalink] Node ${name} is unhealthy. Waiting ${intervalSec}s before next check...`);
    await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
  }
  
  logger.error('system', `[Lavalink] Node ${name} failed healthcheck permanently after ${maxAttempts} attempts. Exiting process...`);
  setTimeout(() => {
    process.exit(1);
  }, 3000);
}

let isRestoredOnce = false;

// 3. Shoukaku 이벤트 리스너 우선 등록
shoukaku.on('ready', (name: string, lavalinkResume: boolean, libraryResume: boolean) => {
  readyNodes.add(name);
  console.log(`[Lavalink] Node connected successfully: ${name} (lavalinkResume: ${lavalinkResume}, libraryResume: ${libraryResume})`);

  if (!isRestoredOnce) {
    isRestoredOnce = true;
    setTimeout(() => {
      restorePlaybackStates({ client, shoukaku, guildStates, runtimeUtils }).catch((err) => {
        logger.error('music', `Failed to restore playback states: ${err.message}`, { error: err });
      });
    }, 1000);
  }
});

shoukaku.on('error', (name: string, error: Error) => {
  readyNodes.delete(name);
  logger.error('system', `[Lavalink] Node error (${name}): ${error.message}`, { error });
});

shoukaku.on('disconnect', (name: string) => {
  readyNodes.delete(name);
  logger.warn('system', `[Lavalink] Node disconnected (${name}). Starting healthcheck wait loop...`);
  void waitAndConnectNode(name);
});


client.once(Events.ClientReady, async (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  await deployCommands({
    clientId,
    token,
    commands: loadedCommands,
  });

  // 디스코드 게이트웨이 연결 및 client.user.id 가 완벽히 준비되었을 때 최초 Lavalink 연결을 가동시킵니다.
  void waitAndConnectNode('main');
});


client.login(token);

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (interaction.isButton() && interaction.customId.startsWith('recommand_')) {
        const recommandCommand = (interaction.client as MyClient).commands.get('recommand');
        if (recommandCommand?.handleComponent) {
          await recommandCommand.handleComponent(interaction, context);
        }
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('search_')) {
        const searchCommand = (interaction.client as MyClient).commands.get('search');
        if (searchCommand?.handleComponent) {
          await searchCommand.handleComponent(interaction, context);
        }
        return;
      }
      if (interaction.customId.startsWith('qctl|')) {
        const queueCommand = (interaction.client as MyClient).commands.get('queue');
        if (queueCommand?.handleComponent) {
          await queueCommand.handleComponent(interaction, context);
        }
        return;
      }
    }

    if (interaction.isAutocomplete()) {
      const command = (interaction.client as MyClient).commands.get(interaction.commandName);
      if (command && typeof command.autocomplete === 'function') {
        try {
          await command.autocomplete(interaction, context);
        }
        catch (err) {
          logger.error('command', `Error handling autocomplete for command ${interaction.commandName}`, { error: err });
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = (interaction.client as MyClient).commands.get(interaction.commandName);
    if (!command) return;

    // 1. 레이트 리미터 체크
    const rateCheck = commandRateLimiter.checkLimit(interaction.user.id);
    if (rateCheck.blocked) {
      logger.warn('security', `Command rate limited: ${interaction.commandName}`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        retryAfterMs: rateCheck.retryAfterMs,
      });
      await interaction.reply({
        content: `명령어 호출이 너무 빠릅니다! 잠시 후 다시 시도해 주세요. (${Math.ceil(rateCheck.retryAfterMs / 1000)}초 후 가능)`,
        ephemeral: true
      }).catch((err) => logger.error('command', 'Interaction reply error during rate limit', { error: err }));
      return;
    }

    const startTime = Date.now();
    await command.execute(interaction, context);
    const latencyMs = Date.now() - startTime;

    logger.info('command', `Executed command: ${interaction.commandName}`, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      latencyMs,
    });
  }
  catch (error: any) {
    logger.error('command', `Command error in ${interaction.isChatInputCommand() ? (interaction as any).commandName : 'unknown'}`, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      error: error.stack,
    });
    if (interaction.isRepliable()) {
      const text = '오류가 발생했어요.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(text).catch((err) => logger.error('command', 'Interaction editReply error during exception handling', { error: err }));
      } else {
        await interaction.reply({ content: text, ephemeral: true }).catch((err) => logger.error('command', 'Interaction reply error during exception handling', { error: err }));
      }
    }
  }
});

client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
  const guildId: string = oldState.guild.id;
  const botMember = oldState.guild.members.me;

  if (!botMember || !botMember.voice.channelId) return;

  const botChannelId: string = botMember.voice.channelId;

  if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
    const channel = oldState.channel;
    if (!channel) return;

    const humanMembers = channel.members.filter(m => !m.user.bot);

    if (humanMembers.size === 0) {
      setTimeout(async () => {
        const currentChannel = client.channels.cache.get(botChannelId);
        if (!currentChannel || !('members' in currentChannel)) return;

        // @ts-ignore
        const stillNoHumans = currentChannel.members.filter((m: any) => !m.user.bot).size === 0;

        if (stillNoHumans) {
          try {
            await runtimeUtils.stopShoukaku(guildId);
          }
          catch (error) {
            logger.error('music', `Error during automatic voice channel leave: ${error instanceof Error ? error.message : String(error)}`, { error });
          }
        }
      }, 3000);
    }
  }
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  const msg: string = message.content;
  if (!msg.includes('치사야') && !msg.includes('치사,')) return;

  // 1. AI 레이트 리미터 체크
  const rateCheck = aiRateLimiter.checkLimit(message.author.id);
  if (rateCheck.blocked) {
    logger.warn('security', 'AI conversation rate limited', {
      userId: message.author.id,
      guildId: message.guildId,
      retryAfterMs: rateCheck.retryAfterMs,
    });
    await safeReply(message, `대화 속도가 너무 빠릅니다! ${Math.ceil(rateCheck.retryAfterMs / 1000)}초 후에 다시 말을 걸어주세요.`);
    return;
  }

  if (message.channel instanceof BaseGuildTextChannel) {
    await message.channel.sendTyping();
  }

  const startTime = Date.now();
  try {
    const response: RuntimeResponse = await talk(message, context);
    const latencyMs = Date.now() - startTime;
    
    logger.info('ai', 'AI conversation succeeded', {
      userId: message.author.id,
      guildId: message.guildId,
      promptLength: msg.length,
      responseLength: response.message.length,
      latencyMs,
    });

    await safeReply(message, `${response.message}`);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    logger.error('ai', 'AI conversation failed', {
      userId: message.author.id,
      guildId: message.guildId,
      latencyMs,
      error: error.stack,
    });
    await safeReply(message, '대화 중 에러가 발생했습니다.');
  }
});

// Graceful Shutdown handling for zero-downtime / seamless deployment
async function gracefulShutdown(signal: string) {
  logger.info('system', `[Shutdown] Received ${signal}. Shutting down gracefully...`);
  try {
    // 1. 현재 각 서버의 음악 재생 상태를 파일에 동기식으로 안전하게 백업 저장
    savePlaybackStatesSync(guildStates);

    // 2. Discord Client Gateway 연결 해제
    await client.destroy();
    logger.info('system', '[Shutdown] Discord client destroyed successfully.');
  } catch (err: any) {
    logger.error('system', `[Shutdown] Error during graceful shutdown: ${err.message}`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('exit', () => {
  savePlaybackStatesSync(guildStates);
});

