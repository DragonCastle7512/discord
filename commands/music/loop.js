const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('반복재생 모드를 활성화/비활성화 합니다.'),
  async execute(interaction, context) {
    const result = await context.music.loop(interaction.guildId);
    await interaction.reply(result.enabled ? '반목모드를 `활성화`했어요!' : '반목모드를 `비활성화`했어요!');
  },
};
