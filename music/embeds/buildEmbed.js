const { EmbedBuilder } = require('discord.js');

function buildEmbed(title, description, footer) {
  const color = 0xcd2929;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footer })
    .setTimestamp();
}

module.exports = { buildEmbed };
