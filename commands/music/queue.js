const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('노래 재생 목록을 확인합니다'),
  async execute(interaction, context) {
    const result = context.music.queue(interaction.guildId);
    await interaction.reply(result.message);
  },
};
