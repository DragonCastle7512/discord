function createTtsRuntime({ runtimeUtils }) {
    async function playTts(interaction, query, input) {
        const guild = interaction.guild;
        if (!guild) throw new Error('Guild only command');

        const member = await guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            return { ok: false, message: '먼저 음성채널에 입장해주세요!' };
        }

        const state = await runtimeUtils.joinOrMovePlayer(guild, interaction.channelId, voiceChannel);
        if (state.playing) {
            return { ok: false, message: '이미 재생중인 음성이 있어요' };
        }

        const { tracks } = await runtimeUtils.resolveTracks(query);
        if (!tracks.length) return { ok: false, message: 'No matches found.' };

        const first = tracks[0];
        state.playing = true;
        state.current = null;
        await state.player.playTrack({ track: { encoded: first.encoded } });

        return { ok: true, message: `치사가 읽어드려요: "${input}"` };
    };
  return { playTts };
}
module.exports = { createTtsRuntime };