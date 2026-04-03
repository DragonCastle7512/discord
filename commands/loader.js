const fs = require('node:fs');
const path = require('node:path');

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

module.exports = {
  loadCommandModules,
  buildCommandPayload,
};
