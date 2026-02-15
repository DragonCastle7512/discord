const { SlashCommandBuilder } = require('discord.js');
const { generateTTS } = require('../../util/tts');
const { createAudioResource, StreamType, createAudioPlayer, NoSubscriberBehavior } = require('@discordjs/voice');
const { Readable } = require('stream');
const join = require('../../util/join');

const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
    },
});

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tts')
        .setDescription('치사가 메세지를 읽어줍니다')
        .addStringOption((option) => option.setName('input').setDescription('메세지').setRequired(true)),
    async execute(interaction) {
        const input = interaction.options.getString('input');
        await interaction.deferReply({ ephemeral: true });
        try {
            const connection = await join(interaction);
            if (!connection || connection.replied) return;

            const audioBuffer = await generateTTS(input);

            const stream = Readable.from(audioBuffer);
            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
            });

            player.play(resource);
            connection.subscribe(player);

            await interaction.editReply({ content: `치사가 읽어드려요: "${input}"` });
        }
        catch (err) {
            console.error(err);
            await interaction.editReply({ content: '문제가 생겼어요. 다시 한 번 시도해주세요.' });
        }
    },
};