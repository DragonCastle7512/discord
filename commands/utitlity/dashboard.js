import { safeReply } from '../../common/reply-util';

const { SlashCommandBuilder } = require('discord.js');
// @ts-ignore
const { generateDashboardToken } = require('../../common/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('나만의 대시보드 링크를 생성합니다.'),
  async execute(interaction) {
    if (!interaction.guildId) {
        return safeReply(interaction, { content: '서버에서만 사용할 수 있는 기능이에요.', ephemeral: true });
    }

    const token = generateDashboardToken(interaction.guildId, interaction.user.id);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const secureUrl = `${baseUrl}/dashboard?token=${token}`;

    await safeReply(interaction, {
      content: `선배, 여기 대시보드 링크예요! 1시간 동안만 유효하니까 주의해 주세요.\n\n🔗 ${secureUrl}`,
      ephemeral: true,
    });

  },
};
