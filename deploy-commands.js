const { REST, Routes } = require('discord.js');
const { DISCORD_TOKEN: token, CLIENT_ID: clientId, GUILD_ID: guildId } = process.env;
const path = require('node:path');
const { loadCommandModules, buildCommandPayload } = require('./commands/loader');

const foldersPath = path.join(__dirname, 'commands');
const { commands, warnings } = loadCommandModules(foldersPath);
for (const warning of warnings) {
	console.log(warning);
}
const commandPayload = buildCommandPayload(commands);

const rest = new REST().setToken(token);

(async () => {
	try {
		if (!token || !clientId) {
			throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');
		}

		const data = await rest.put(Routes.applicationCommands(clientId), { body: commandPayload });
		console.log(`Successfully reloaded ${data.length} global application (/) commands.`);

		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
			console.log(`Cleared guild-specific application (/) commands for guild: ${guildId}`);
		}
	}
	catch (error) {
		console.error(error);
	}
})();
