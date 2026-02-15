const { joinVoiceChannel } = require('@discordjs/voice');

module.exports = async function join(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;

    const content = '음성 채널에 먼저 들어가주세요!';
    if (!voiceChannel) {
        if (interaction.deferred || interaction.replied) {
            interaction.editReply({ content });
        }
        else {
            interaction.reply({ content, ephemeral: true });
        }
        return null;
    }
    return joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
    });
};
