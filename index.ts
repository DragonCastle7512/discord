import path from 'node:path';
import { Shoukaku, Connectors } from 'shoukaku';
import { Client, Events, GatewayIntentBits, Collection, Message, Interaction, VoiceState, BaseGuildTextChannel } from 'discord.js';
// @ts-ignore
import express, { Request, Response, Express } from 'express';
import { 
  MusicRuntime, 
  TtsRuntime, 
  RuntimeUtils, 
  AppContext, 
  GuildState 
} from './types';

const { talk } = require('./ai/talk');
const { createMusicRuntime } = require('./music/runtime');
const { createTtsRuntime } = require('./tts/runtime');
const { createRuntimeUtils } = require('./music/runtime-util');
const { initDb } = require('./db/init');
const { createTtsHttpStore } = require('./tts/http-store');
const { loadCommandModules } = require('./commands/loader');
const { createSlashCommandInvoker } = require('./commands/slash-command-invoker');

const token: string = process.env.DISCORD_TOKEN || '';
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

const ttsHttpStore = createTtsHttpStore({
  baseUrl: ttsPublicUrl,
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/tts/:id.wav', (req: Request, res: Response) => {
  const entry = ttsHttpStore.get(req.params.id);
  if (!entry) {
    res.status(404).send('Not found');
    return;
  }
  res.set('Content-Type', entry.contentType);
  res.set('Cache-Control', 'no-store');
  res.send(entry.buffer);
});

app.listen(httpPort, httpHost, () => {
  console.log(`[HTTP] listening on ${httpHost}:${httpPort}`);
});

if (!token || !lavalinkHost || !lavalinkPassword) {
  console.error('Missing essential environment variables.');
  process.exit(1);
}

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
  [
    {
      name: 'main',
      url: `${lavalinkHost}:${lavalinkPort}`,
      auth: lavalinkPassword,
      secure: lavalinkSecure,
    },
  ],
  {
    reconnectTries: 9999,
    reconnectInterval: 3_000,
    moveOnDisconnect: false,
    resume: false,
  },
);

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

shoukaku.on('ready', (name: string) => {
  readyNodes.add(name);
  console.log(`[Lavalink] Node connected: ${name}`);
});

shoukaku.on('error', (name: string, error: Error) => {
  readyNodes.delete(name);
  console.error(`[Lavalink] Node error (${name}):`, error);
});

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
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
      if (interaction.customId.startsWith('qctl|')) {
        const queueCommand = (interaction.client as MyClient).commands.get('queue');
        if (queueCommand?.handleComponent) {
          await queueCommand.handleComponent(interaction, context);
        }
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const command = (interaction.client as MyClient).commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction, context);
  }
  catch (error: any) {
    console.error('Command error:', error);
    if (interaction.isRepliable()) {
      const text = '오류가 발생했어요.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(text).catch(console.error);
      } else {
        await interaction.reply({ content: text, ephemeral: true }).catch(console.error);
      }
    }
  }
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  const msg: string = message.content;
  if (!msg.includes('치사야') && !msg.includes('치사,')) return;

  if (message.channel instanceof BaseGuildTextChannel) {
    await message.channel.sendTyping();
  }

	const response: string = await talk(message, context);
	await message.reply(`${response}`);
});
