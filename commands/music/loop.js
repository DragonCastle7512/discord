const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('반복재생 활성화/비활성화 모드를 전환합니다.')
    .addBooleanOption(option =>
      option.setName('enable')
        .setDescription('반복재생 모드를 활성화/비활성화 상태로 만듭니다.'),
    ),
  async execute(interaction, context) {
    const enable = interaction.options.getBoolean('enable');
    const result = await context.music.loop(interaction.guildId, enable);
    await interaction.reply(result.enabled ? '반목모드를 `활성화`했어요!' : '반목모드를 `비활성화`했어요!');
  },
};
