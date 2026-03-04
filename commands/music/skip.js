const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('현재 재생중인 노래를 넘깁니다'),
  async execute(interaction, context) {
    const result = await context.music.skip(interaction.guildId);
    await interaction.reply(result.message);
  },
};
