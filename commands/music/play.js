const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

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
    if (!query) {
      await interaction.editReply(result.message);
      return;
    }
    const title = result.ok ? 'Play' : 'Play Error';
    const embed = buildEmbed(title, result.message, interaction.guild?.name || 'Music');
    await interaction.editReply({ embeds: [embed] });
  },
};
