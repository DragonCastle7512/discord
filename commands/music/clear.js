const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('플레이리스트를 초기화합니다.'),
  async execute(interaction, context) {
    const result = await context.music.clearToPlaylist(interaction.user.id);
    await interaction.reply({ content: result.message, ephemeral: true });
  },
};
