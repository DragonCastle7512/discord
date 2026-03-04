const fs = require('node:fs');
const path = require('node:path');
const { Shoukaku, Connectors } = require('shoukaku');
const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const { talk } = require('./ai/talk');
const { createMusicRuntime } = require('./util/runtime');

const token = process.env.DISCORD_TOKEN;
const allowSoundCloudFallback = process.env.ALLOW_SOUNDCLOUD_FALLBACK === 'true';
const lavalinkReadyTimeoutMs = Number(process.env.LAVALINK_READY_TIMEOUT_MS || 20000);

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

const music = createMusicRuntime({
  client,
  shoukaku,
  readyNodes,
  allowSoundCloudFallback,
  lavalinkReadyTimeoutMs,
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
client.commands = new Collection();
client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = interaction.client.commands.get(interaction.commandName);

	try {
		await command.execute(interaction, { client, shoukaku, music });
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