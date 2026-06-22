import { safeReply } from '../../common/reply-util';
import { logger } from '../../common/logger';
import fs from 'node:fs';
import path from 'node:path';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('최근 시스템 로그를 조회하거나 파일로 다운로드합니다.')
    .addIntegerOption(opt =>
      opt.setName('lines')
        .setDescription('가져올 최근 로그 라인 수 (기본값: 30, 최대: 100)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('level')
        .setDescription('특정 로그 레벨만 보기 (INFO, WARN, ERROR)')
        .addChoices(
          { name: 'INFO', value: 'INFO' },
          { name: 'WARN', value: 'WARN' },
          { name: 'ERROR', value: 'ERROR' }
        )
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('export')
        .setDescription('로그 파일 자체를 파일로 다운로드할지 여부')
        .setRequired(false)
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

    const linesOption = interaction.options.getInteger('lines') || 30;
    const linesLimit = Math.min(Math.max(linesOption, 1), 100);
    const levelOption = interaction.options.getString('level');
    const exportOption = interaction.options.getBoolean('export') || false;

    const logPath = path.join(__dirname, '../../logs/app.log');

    if (!fs.existsSync(logPath)) {
      return safeReply(interaction, { content: '아직 로그 파일이 존재하지 않습니다.', ephemeral: true });
    }

    // 2. 파일 다운로드 모드
    if (exportOption) {
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

    // 3. 단순 텍스트 조회 모드
    try {
      const rawContent = fs.readFileSync(logPath, 'utf8');
      const lines = rawContent.split('\n').filter(line => line.trim() !== '');
      
      let filteredEntries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null);

      if (levelOption) {
        filteredEntries = filteredEntries.filter(entry => entry.level === levelOption);
      }

      // Get last N logs
      const targetEntries = filteredEntries.slice(-linesLimit);

      if (targetEntries.length === 0) {
        return safeReply(interaction, { content: '조건에 일치하는 로그가 없습니다.', ephemeral: true });
      }

      const formatted = targetEntries.map(entry => {
        const time = entry.timestamp ? entry.timestamp.split('T')[1].slice(0, 8) : '00:00:00';
        const metaStr = entry.metadata?.userId ? ` (${entry.metadata.userId})` : '';
        return `[${time}] [${entry.level}] [${entry.category}] ${entry.message}${metaStr}`;
      }).join('\n');

      const messageBlock = `\`\`\`\n${formatted}\n\`\`\``;
      if (messageBlock.length > 2000) {
        // Truncate to fit discord message length limit (2000 chars)
        const truncated = formatted.slice(-(2000 - 20));
        return safeReply(interaction, { content: `\`\`\`\n...${truncated}\n\`\`\``, ephemeral: true });
      }

      return safeReply(interaction, { content: messageBlock, ephemeral: true });
    } catch (err) {
      logger.error('system', 'Failed to read log file', { error: err.stack });
      return safeReply(interaction, { content: '로그 파일을 읽는 중 오류가 발생했습니다.', ephemeral: true });
    }
  }
};
