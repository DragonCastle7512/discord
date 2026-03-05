const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateTTS } = require('../../util/tts');

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

            if (!context?.music?.play) {
                await interaction.editReply({ content: '노래가 아직 재생중입니다!' });
                return;
            }

            const audioBuffer = await generateTTS(input);
            const fileName = `tts-${Date.now()}.wav`;
            const attachment = new AttachmentBuilder(audioBuffer, { name: fileName });
            const tempMessage = await interaction.channel.send({ files: [attachment] });
            const ttsUrl = tempMessage.attachments.first()?.url;

            if (!ttsUrl) {
                await interaction.editReply({ content: 'tts 파일 업로드 실패' });
                return;
            }

            await context.music.playTts(interaction, ttsUrl);
            await interaction.editReply({ content: `치사가 읽어드려요: "${input}"` });
        }
        catch (err) {
            console.error(err);
            await interaction.editReply({ content: '문제가 생겼어요. 다시 한 번 시도해주세요.' });
        }
    },
};