import { safeReply } from '../../common/reply-util';
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('현재 노래를 일시정지/재개 합니다.'),
  async execute(interaction, context) {
    const result = await context.music.pause(interaction.guildId);
    await safeReply(interaction, result.message);
  },
};
