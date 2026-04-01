const { SlashCommandBuilder } = require('discord.js');
const { generateTTS } = require('../../tts/tts');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tts')
        .setDescription('치사가 메세지를 읽어줍니다')
        .addStringOption((option) => option.setName('input').setDescription('메세지').setRequired(true)),
    async execute(interaction, context) {
        const input = interaction.options.getString('input');
        await interaction.deferReply({ ephemeral: true });
        try {
            if (!interaction.channel) {
                await interaction.editReply({ content: '음성채널에 먼저 접속해주세요!' });
                return;
            }

            if (!context?.tts?.createPlayableUrl || !context?.tts?.playTts) {
                await interaction.editReply({ content: 'TTS 런타임이 준비되지 않았어요. 이미 재생되고 있는 음성이 있는지 확인해주세요!' });
                return;
            }

            const audioBuffer = await generateTTS(input);
            if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
                await interaction.editReply({ content: 'TTS 음성 생성에 실패했습니다.' });
                return;
            }

            const ttsUrl = context.tts.createPlayableUrl(audioBuffer);
            if (!ttsUrl) {
                await interaction.editReply({ content: 'tts 파일 업로드 실패' });
                return;
            }

            await context.tts.playTts(interaction, ttsUrl, input);
            await interaction.editReply({ content: `치사가 읽어드려요: "${input}"` });
        }
        catch (err) {
            console.error(err);
            await interaction.editReply({ content: '문제가 생겼어요. 다시 한 번 시도해주세요.' });
        }
    },
};