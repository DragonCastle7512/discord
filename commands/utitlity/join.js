const { SlashCommandBuilder } = require('discord.js');
const join = require('../../util/join');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('접속한 현재 음성 채널로 초대합니다'),
    async execute(interaction) {
        const connection = join(interaction);
        if (!connection || connection.replied) return;
        await interaction.reply({ content: '음성 채널로 들어왔어요!', ephemeral: true });
        setTimeout(() => interaction.deleteReply(), 1000);
    },
};