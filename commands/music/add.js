const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('플레이리스트에 노래를 추가합니다.')
    .addStringOption((option) =>
      option.setName('music').setDescription('노래 제목 또는 URL').setRequired(false),
    ),
  async execute(interaction, context) {
    await interaction.deferReply();
    const query = interaction.options.getString('music') || '';
    const result = await context.music.addToPlaylist(interaction.guildId, interaction.user.id, query);
    await interaction.editReply(result.message);
  },
};
