const {
  SlashCommandBuilder,
  ButtonStyle,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
} = require('discord.js');
const {
  clampRecommendationCount,
  recommendFromHistory,
} = require('../../music/services/recommand-service');
const { buildTrackListContainer, findUriByButtonCustomId } = require('../../music/embeds/track-list-components');
import { safeReply } from '../../common/reply-util';

// 사용자별 추천 결과를 저장할 인메모리 캐시
const recommendationCache = new Map();


function buildRecommendationComponents(tracks, ownerUserId, startIndex = 0) {
  const chunkSize = 5;
  const currentChunk = tracks.slice(startIndex, startIndex + chunkSize);

  const container = buildTrackListContainer({
    tracks: currentChunk,
    startIndex,
    userId: ownerUserId,
    customIdPrefix: 'recommand_play',
  });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`recommand_back:${ownerUserId}:${startIndex - chunkSize}`)
        .setLabel('이전')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(startIndex === 0),
      new ButtonBuilder()
        .setCustomId(`recommand_next:${ownerUserId}:${startIndex + chunkSize}`)
        .setLabel('다음')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(startIndex + chunkSize >= tracks.length),
    );

  return [container, row];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommand')
    .setDescription('히스토리 기반으로 노래를 추천합니다.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('특정 사용자의 히스토리 기준으로 추천합니다.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('count')
        .setDescription('추천 곡 개수 (최대 20)')
        .setRequired(false),
    ),

  async execute(interaction, context) {
    await interaction.deferReply();

    const count = clampRecommendationCount(interaction.options.getString('count'));
    const targetUser = interaction.options.getUser('user');
    const targetUserId = targetUser?.id || interaction.user.id;

    const historyResult = await context.music.history(interaction.guildId, targetUserId);
    const allHistoryItems = Array.isArray(historyResult?.items) ? historyResult.items : [];

    // 실제 추천 API 호출
    const result = await recommendFromHistory({
      historyItems: allHistoryItems,
      count,
      searchTracks: (query) => context.music.searchTracks(query),
      region: 'KR',
      guildId: interaction.guildId,
      userId: targetUserId,
    });

    if (!result || !result.ok || !Array.isArray(result.items) || result.items.length === 0) {
      await safeReply(interaction, { content: result?.reason || '추천 결과가 없어요.' });
      return;
    }

    const tracks = result.items;
    // 결과를 캐시에 저장 (사용자 ID 기준)
    recommendationCache.set(interaction.user.id, tracks);

    await safeReply(interaction, { content: '추천 결과를 불러왔어요!' });

    // 첫 페이지(index 0) 표시
    const components = buildRecommendationComponents(tracks, interaction.user.id, 0);
    await safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components,
    });
  },

  canHandleComponent(interaction) {
    return interaction.isButton() && String(interaction.customId || '').startsWith('recommand_');
  },

  async handleComponent(interaction, context) {
    const customId = String(interaction.customId || '');
    const [prefix, ownerUserId, arg] = customId.split(':');

    if (interaction.user.id !== ownerUserId) {
      await safeReply(interaction, { content: '명령 실행자만 사용할 수 있어요.', ephemeral: true });
      return;
    }

    // 재생 버튼 처리
    if (prefix === 'recommand_play') {
      const uri = findUriByButtonCustomId(interaction.message?.components, interaction.customId);
      if (!uri) {
        await safeReply(interaction, {
          content: '추천 메시지에서 곡 URL을 읽지 못했어요. `/recommand`를 다시 실행해주세요.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferUpdate();
      const playResult = await context.music.play(interaction, uri);
      const notice = playResult?.message || '선택한 곡을 큐에 추가했어요.';
      await safeReply(interaction, { content: notice, ephemeral: true }).catch(async () => {
        if (interaction.channel) await interaction.channel.send(notice);
      });
      return;
    }

    // 이전/다음 버튼 처리
    if (prefix === 'recommand_back' || prefix === 'recommand_next') {
      const startIndex = parseInt(arg, 10);
      const tracks = recommendationCache.get(ownerUserId);

      if (!tracks || !Array.isArray(tracks)) {
        await safeReply(interaction, {
          content: '캐시된 추천 결과가 없어요. `/recommand`를 다시 실행해 주세요.',
          ephemeral: true,
        });
        return;
      }

      const components = buildRecommendationComponents(tracks, ownerUserId, startIndex);
      await interaction.update({
        flags: MessageFlags.IsComponentsV2,
        components,
      });
    }
  },
};
