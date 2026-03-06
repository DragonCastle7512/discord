const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('플레이리스트 목록을 확인합니다.'),
  async execute(interaction, context) {
    const result = await context.music.getPlaylist(interaction.user.id);
    await interaction.reply(result.message);
  },
};
