import { safeReply } from '../../common/reply-util';
import { logger } from '../../common/logger';
import { generateDashboardToken } from '../../common/auth';
import fs from 'node:fs';
import path from 'node:path';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('시스템 로그를 웹 뷰어로 보거나 파일로 다운로드합니다.')
    .addStringOption(opt =>
      opt.setName('output')
        .setDescription('로그 출력 방식을 선택합니다 (기본값: 웹 링크 제공)')
        .setRequired(false)
        .addChoices(
          { name: '웹 링크 제공', value: 'link' },
          { name: '파일로 추출', value: 'file' }
        )
    ),

  async execute(interaction) {
    const ownerId = process.env.OWNER_ID;
    
    // 1. 소유자 권한 체크
    if (!ownerId || interaction.user.id !== ownerId) {
      logger.warn('security', 'Unauthorized admin logs attempt', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        command: '/logs',
      });
      return safeReply(interaction, { content: '이 명령어를 사용할 권한이 없습니다.', ephemeral: true });
    }

    const outputOption = interaction.options.getString('output') || 'link';
    const logPath = path.join(__dirname, '../../logs/app.log');

    if (!fs.existsSync(logPath)) {
      return safeReply(interaction, { content: '아직 로그 파일이 존재하지 않습니다.', ephemeral: true });
    }

    // 2. 파일 다운로드 모드
    if (outputOption === 'file') {
      try {
        const attachment = new AttachmentBuilder(logPath, { name: 'app.log' });
        return safeReply(interaction, {
          content: '최신 로그 파일입니다.',
          files: [attachment],
          ephemeral: true,
        });
      } catch (err) {
        logger.error('system', 'Failed to export log file', { error: err.stack });
        return safeReply(interaction, { content: '로그 파일을 내보내지 못했습니다.', ephemeral: true });
      }
    }

    // 3. 웹 링크 제공 모드
    try {
      const token = generateDashboardToken(interaction.guildId || 'global', interaction.user.id);
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const secureUrl = `${baseUrl}/admin/${token}`;

      return safeReply(interaction, {
        content: `선배, 여기 로그 확인 페이지 링크예요! 1시간 동안만 유효하니까 주의해 주세요.\n\n🔗 ${secureUrl}`,
        ephemeral: true,
      });
    } catch (err) {
      logger.error('system', 'Failed to generate logs link', { error: err.stack });
      return safeReply(interaction, { content: '로그 링크를 생성하지 못했습니다.', ephemeral: true });
    }
  }
};
