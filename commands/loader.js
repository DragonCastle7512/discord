const fs = require('node:fs');
const path = require('node:path');

const { REST, Routes } = require('discord.js');

function loadCommandModules(commandsRoot) {
  const commands = new Map();
  const warnings = [];

  const commandFolders = fs.readdirSync(commandsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const folder of commandFolders) {
    const commandsPath = path.join(commandsRoot, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        commands.set(command.data.name, command);
      }
      else {
        warnings.push(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
      }
    }
  }

  return { commands, warnings };
}

function buildCommandPayload(commands) {
  return [...commands.values()].map((command) => command.data.toJSON());
}

async function deployCommands({ clientId, token, commands, guildId = null }) {
  const rest = new REST().setToken(token);
  const commandPayload = buildCommandPayload(commands);

  try {
    if (guildId) {
      const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandPayload });
      console.log(`[Deploy] Successfully reloaded ${data.length} application (/) commands for guild: ${guildId}`);
    }
    else {
      const data = await rest.put(Routes.applicationCommands(clientId), { body: commandPayload });
      console.log(`[Deploy] Successfully reloaded ${data.length} global application (/) commands.`);
    }
  }
  catch (error) {
    console.error('[Deploy] Error:', error);
  }
}

module.exports = {
  loadCommandModules,
  buildCommandPayload,
  deployCommands,
};
