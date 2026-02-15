const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    data: new SlashCommandBuilder()
	    .setName('echo')
	    .setDescription('치사가 메세지를 보냅니다')
	    .addStringOption((option) => option.setName('input').setDescription('출력할 메세지').setRequired(true)),
    async execute(interaction) {
        const input = interaction.options.getString('input');
        try {
            await interaction.channel.send(input);
            await interaction.reply({ content: '메시지를 전송했어요', ephemeral: true });
            setTimeout(() => interaction.deleteReply(), 1000);
        }
        catch (err) {
            console.log(err);
        }
    },
};