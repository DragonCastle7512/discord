const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { buildTrackListContainer, findUriByButtonCustomId } = require('../../music/embeds/track-list-components');
import { safeReply } from '../../common/reply-util';

const RESULT_LIMIT = 5;

function buildSearchComponents(query, tracks, ownerUserId) {
  const container = buildTrackListContainer({
    tracks,
    startIndex: 0,
    userId: ownerUserId,
    customIdPrefix: 'search_play',
  });

  return [container];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('특정 키워드의 상위 결과 5개를 조회합니다.')
    .addStringOption((option) =>
      option.setName('query').setDescription('검색할 노래 제목').setRequired(true),
    ),

  async execute(interaction, context) {
    await interaction.deferReply();

    const query = (interaction.options.getString('query') || '').trim();
    const result = await context.music.searchTracks(query);
    const tracks = (Array.isArray(result?.tracks) ? result.tracks : [])
      .filter((track) => track?.info)
      .slice(0, RESULT_LIMIT);

    if (!tracks.length) {
      await safeReply(interaction, { content: '검색 결과가 없어요.' });
      return;
    }

    await safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components: buildSearchComponents(query, tracks, interaction.user.id),
    });
  },

  canHandleComponent(interaction) {
    return interaction.isButton() && String(interaction.customId || '').startsWith('search_');
  },

  async handleComponent(interaction, context) {
    const [prefix, ownerUserId, indexText] = String(interaction.customId || '').split(':');

    if (prefix !== 'search_play') return;

    if (interaction.user.id !== ownerUserId) {
      await safeReply(interaction, { content: '명령을 실행한 사용자만 선택할 수 있어요.', ephemeral: true });
      return;
    }

    const selectedIndex = Number(indexText);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= RESULT_LIMIT) {
      await safeReply(interaction, { content: '잘못된 검색 결과 번호예요.', ephemeral: true });
      return;
    }

    const uri = findUriByButtonCustomId(interaction.message?.components, interaction.customId);
    if (!uri) {
      await safeReply(interaction, {
        content: '검색 결과 URL을 찾지 못했어요. `/search`를 다시 실행해 주세요.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();
    const playResult = await context.music.play(interaction, uri);
    const notice = playResult?.message || '선택한 곡을 대기열에 추가했어요.';
    await interaction.followUp({ content: notice, ephemeral: true }).catch(async () => {
      if (interaction.channel) await interaction.channel.send(notice);
    });
  },
};
