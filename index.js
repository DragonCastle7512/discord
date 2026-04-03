const path = require('node:path');
const { Shoukaku, Connectors } = require('shoukaku');
const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const express = require('express');
const { talk } = require('./ai/talk');
const { createMusicRuntime } = require('./music/runtime');
const { createTtsRuntime } = require('./tts/runtime');
const { createRuntimeUtils } = require('./music/runtime-util');
const { initDb } = require('./db/init');
const { createTtsHttpStore } = require('./tts/http-store');
const { loadCommandModules } = require('./commands/loader');
const { createSlashCommandInvoker } = require('./commands/slash-command-invoker');

const token = process.env.DISCORD_TOKEN;
const allowSoundCloudFallback = process.env.ALLOW_SOUNDCLOUD_FALLBACK === 'true';
const lavalinkReadyTimeoutMs = Number(process.env.LAVALINK_READY_TIMEOUT_MS || 20000);
const lavalinkHost = process.env.LAVALINK_HOST;
const lavalinkPort = Number(process.env.LAVALINK_PORT || 2333);
const lavalinkPassword = process.env.LAVALINK_PASSWORD;
const lavalinkSecure = process.env.LAVALINK_SECURE === 'true';

const httpPort = 3000;
const httpHost = '0.0.0.0';
const ttsPublicUrl = (process.env.TTS_PUBLIC_BASE_URL || `http://localhost:${httpPort}`);
const app = express();

const ttsHttpStore = createTtsHttpStore({
  baseUrl: ttsPublicUrl,
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/tts/:id.wav', (req, res) => {
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

if (!token) {
  console.error('DISCORD_TOKEN is missing in .env');
  process.exit(1);
}

if (!lavalinkHost || !lavalinkPassword) {
  console.error('LAVALINK_HOST or LAVALINK_PASSWORD is missing in .env');
  process.exit(1);
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates,
	],
});

const readyNodes = new Set();
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

const guildStates = new Map();

const runtimeUtils = createRuntimeUtils({
  client,
  shoukaku,
  readyNodes,
  allowSoundCloudFallback,
  lavalinkReadyTimeoutMs,
  guildStates,
});


const music = createMusicRuntime({
  guildStates,
  runtimeUtils,
});

const tts = createTtsRuntime({ runtimeUtils, ttsHttpStore });

const context = { music, tts };

const commandsRoot = path.join(__dirname, 'commands');
const { commands: loadedCommands, warnings } = loadCommandModules(commandsRoot);
for (const warning of warnings) {
  console.log(warning);
}
client.commands = new Collection();
for (const [name, command] of loadedCommands.entries()) {
  client.commands.set(name, command);
}

context.slashCommands = createSlashCommandInvoker({
  commands: client.commands,
  context,
});

shoukaku.on('ready', (name) => {
  readyNodes.add(name);
  console.log(`[Lavalink] Node connected: ${name}`);
});

shoukaku.on('error', (name, error) => {
  readyNodes.delete(name);
  console.error(`[Lavalink] Node error (${name}):`, error);
});

shoukaku.on('close', (name, code, reason) => {
  readyNodes.delete(name);
  console.warn(`[Lavalink] Node closed (${name}) code=${code} reason=${reason || ''}`);
});

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(token);
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith('qctl|')) return;
      const queueCommand = interaction.client.commands.get('queue');
      if (!queueCommand || typeof queueCommand.handleComponent !== 'function') return;
      await queueCommand.handleComponent(interaction, context);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction, context);
  }
  catch (error) {
    console.error('Command error:', error);
    const reason = String(error.message || '');
    const text = reason.includes('Track lookup failed')
      ? '트랙 재생에 실패했어요.'
      : '오류가 발생했어요.';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(text).catch((err) => console.error(err));
    }
    else if (interaction.isRepliable()) {
      await interaction.reply({ content: text, ephemeral: true }).catch((err) => console.error(err));
    }
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild.id;
  const botMember = oldState.guild.members.me;

  if (!botMember.voice.channelId) return;

  const botChannelId = botMember.voice.channelId;

  if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
    const channel = oldState.channel;

    const humanMembers = channel.members.filter(m => !m.user.bot);

    if (humanMembers.size === 0) {
      setTimeout(async () => {
        const currentChannel = client.channels.cache.get(botChannelId);
        if (!currentChannel) return;

        const stillNoHumans = currentChannel.members.filter(m => !m.user.bot).size === 0;

        if (stillNoHumans) {
          try {
            await runtimeUtils.stopShoukaku(guildId);
          }
          catch (error) {
            console.error('퇴장 중 오류 발생:', error);
          }
        }
      }, 3000);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const msg = message.content;
  if (!msg.includes('치사야') && !msg.includes('치사,')) return;
	await message.channel.sendTyping();
	const response = await talk(message, context);
	await message.reply(`${response}`);
});
