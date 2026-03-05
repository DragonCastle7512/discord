const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('모든 모래 재생을 끝내고, 음성 채널을 나갑니다.'),
  async execute(interaction, context) {
    const result = await context.music.stop(interaction.guildId);
    await interaction.reply(result.message);
  },
};
