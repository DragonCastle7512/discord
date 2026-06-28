const { SlashCommandBuilder } = require('discord.js');
const { generateTTS } = require('../../tts/tts');
import { safeReply } from '../../common/reply-util';
import { logger } from '../../common/logger';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tts')
        .setDescription('치사가 메세지를 읽어줍니다')
        .addStringOption((option) => option.setName('input').setDescription('메세지').setRequired(true)),
    async execute(interaction, context) {
        // TTS 화이트리스트 체크
        const whitelist = (process.env.TTS_GUILD_WHITELIST || '').split(',').map(id => id.trim());
        const isWhitelisted = whitelist.includes(interaction.guildId);

        if (!isWhitelisted && process.env.NODE_ENV === 'production') {
            return safeReply(interaction, {
                content: '선배, 죄송해요. 현재 이 서버에서는 TTS 기능을 사용할 수 없도록 제한되어 있어요.',
                ephemeral: true,
            });
        }

        const input = interaction.options.getString('input');
        await interaction.deferReply({ ephemeral: true });
        try {
            if (!interaction.channel) {
                await safeReply(interaction, { content: '음성채널에 먼저 접속해주세요!' });
                return;
            }

            if (!context?.tts?.createPlayableUrl || !context?.tts?.playTts) {
                await safeReply(interaction, { content: 'TTS 런타임이 준비되지 않았어요. 이미 재생되고 있는 음성이 있는지 확인해주세요!' });
                return;
            }

            const audioBuffer = await generateTTS(input);
            if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
                await safeReply(interaction, { content: 'TTS 음성 생성에 실패했습니다.' });
                return;
            }

            const ttsUrl = context.tts.createPlayableUrl(audioBuffer);
            if (!ttsUrl) {
                await safeReply(interaction, { content: 'tts 파일 업로드 실패' });
                return;
            }

            await context.tts.playTts(interaction, ttsUrl, input);
            await safeReply(interaction, { content: `치사가 읽어드려요: "${input}"` });
        }
        catch (err) {
            logger.error('ai', `TTS command execution failed: ${err instanceof Error ? err.message : String(err)}`, { error: err });
            await safeReply(interaction, { content: '문제가 생겼어요. 다시 한 번 시도해주세요.' });
        }
    },
};