const fs = require('node:fs');
const path = require('node:path');
const { Shoukaku, Connectors } = require('shoukaku');
const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const { talk } = require('./ai/talk');
const { createMusicRuntime } = require('./music/runtime');
const { createTtsRuntime } = require('./tts/runtime');
const { createRuntimeUtils } = require('./music/runtime-util');
const { initDb } = require('./db/init');

const token = process.env.DISCORD_TOKEN;
const allowSoundCloudFallback = process.env.ALLOW_SOUNDCLOUD_FALLBACK === 'true';
const lavalinkReadyTimeoutMs = Number(process.env.LAVALINK_READY_TIMEOUT_MS || 20000);
const lavalinkPrewarmEnabled = process.env.LAVALINK_PREWARM_ENABLED !== 'false';
const lavalinkPrewarmDelayMs = Number(process.env.LAVALINK_PREWARM_DELAY_MS || 3000);
const lavalinkPrewarmRetries = Number(process.env.LAVALINK_PREWARM_RETRIES || 3);
const lavalinkPrewarmRetryDelayMs = Number(process.env.LAVALINK_PREWARM_RETRY_DELAY_MS || 1200);
const lavalinkPrewarmIdentifiers = (process.env.LAVALINK_PREWARM_IDENTIFIERS ||
  'https://youtu.be/dQw4w9WgXcQ,ytmsearch:test')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const lavalinkHost = process.env.LAVALINK_HOST;
const lavalinkPort = Number(process.env.LAVALINK_PORT || 2333);
const lavalinkPassword = process.env.LAVALINK_PASSWORD;
const lavalinkSecure = process.env.LAVALINK_SECURE === 'true';

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

const tts = createTtsRuntime({ runtimeUtils });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getActiveNode() {
  return (
    (readyNodes.has('main') && shoukaku.nodes.get('main')) ||
    [...readyNodes].map((name) => shoukaku.nodes.get(name)).find(Boolean) ||
    null
  );
}

function didLoadTracks(result) {
  if (!result || result.loadType === 'empty' || result.loadType === 'error') {
    return false;
  }

  if (result.loadType === 'track') return Boolean(result.data);
  if (result.loadType === 'playlist') return (result.data?.tracks || []).length > 0;
  if (result.loadType === 'search') return Array.isArray(result.data) && result.data.length > 0;
  return false;
}

async function prewarmLavalinkNode(nodeName) {
  if (!lavalinkPrewarmEnabled) return;
  if (!lavalinkPrewarmIdentifiers.length) return;

  await sleep(Math.max(0, lavalinkPrewarmDelayMs));

  const node = shoukaku.nodes.get(nodeName) || getActiveNode();
  if (!node) return;

  for (const identifier of lavalinkPrewarmIdentifiers) {
    let success = false;
    let lastError = null;

    for (let attempt = 1; attempt <= Math.max(1, lavalinkPrewarmRetries); attempt++) {
      try {
        const result = await node.rest.resolve(identifier);
        if (didLoadTracks(result)) {
          success = true;
          console.log(`[Lavalink] Prewarm success (${identifier}) on attempt ${attempt}`);
          break;
        }
      }
	  catch (error) {
        lastError = error;
      }

      if (attempt < Math.max(1, lavalinkPrewarmRetries)) {
        await sleep(Math.max(0, lavalinkPrewarmRetryDelayMs));
      }
    }

    if (!success) {
      const detail = lastError?.message ? `: ${lastError.message}` : '';
      console.warn(`[Lavalink] Prewarm failed (${identifier})${detail}`);
    }
  }
}

shoukaku.on('ready', (name) => {
  readyNodes.add(name);
  console.log(`[Lavalink] Node connected: ${name}`);
  prewarmLavalinkNode(name).catch((error) => {
    console.warn(`[Lavalink] Prewarm error on node ${name}: ${error.message || error}`);
  });
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
client.commands = new Collection();
client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = interaction.client.commands.get(interaction.commandName);

	try {
		await command.execute(interaction, { music, tts });
	}
	catch (error) {
		console.error('Command error:', error);
		const reason = String(error.message || '');
		const text = reason.includes('Track lookup failed')
		? 'Track search failed on Lavalink sources. Try a direct URL or another keyword.'
		: 'An error occurred while processing your command.';

		if (interaction.deferred || interaction.replied) {
			await interaction.editReply(text).catch((err) => console.error(err));
		}
		else {
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
  if (!msg.includes('치사야') || msg.includes('치사,')) return;
	const input = message.content;
	const userId = message.member.id;
	await message.channel.sendTyping();
	const response = await talk(input, userId);
	await message.reply(`${response}`);
});

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		}
		else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}