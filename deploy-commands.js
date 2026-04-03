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
		const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandPayload });
		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	}
	catch (error) {
		console.error(error);
	}
})();
