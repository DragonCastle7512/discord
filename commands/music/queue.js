const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('노래 재생 목록을 확인합니다'),
  async execute(interaction, context) {
    const result = context.music.queue(interaction.guildId);
    const embed = buildEmbed('Queue', result.message || [], `${result.count} track(s)`);
    await interaction.reply({ embeds: [embed] });
  },
};
