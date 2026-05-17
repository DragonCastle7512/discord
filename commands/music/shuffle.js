import { safeReply } from '../../common/reply-util';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('대기열의 곡 순서를 무작위로 섞습니다.'),
  async execute(interaction, context) {
    const result = context.music.shuffleQueue(interaction.guildId);
    await safeReply(interaction, result.message);
  },
};
