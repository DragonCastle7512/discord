const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('플레이리스트 목록을 확인합니다.'),
  async execute(interaction, context) {
    const result = await context.music.getPlaylist(interaction.user.id);
    const embed = buildEmbed('PlayList', result.message || [], `${result.count} track(s)`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
