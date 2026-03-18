const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('노래를 재생합니다')
    .addStringOption((option) =>
      option.setName('query').setDescription('노래 제목 또는 URL').setRequired(false),
    ),
  async execute(interaction, context) {
    await interaction.deferReply();
    const query = (interaction.options.getString('query') || '').trim();
    const result = await context.music.play(interaction, query);
    await interaction.editReply(result.message);
  },
};
