const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');
const { handlers: musicSkillHandlers } = require('../../ai/skills/music-skill');
const {
  clampRecommendationCount,
  formatDuration,
  recommendFromHistory,
} = require('../../music/recommand-service');

async function fetchPopularByKeyword({ keyword, limit, region }) {
  const output = await musicSkillHandlers.get_youtube_popular_music({
    keyword,
    order: 'viewCount',
    limit,
    region,
  });

  if (typeof output === 'string') return [];
  if (!output || typeof output !== 'object' || !Array.isArray(output.items)) return [];
  return output.items;
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
        .setDescription('추천 곡 개수 (최대 10)')
        .setRequired(false),
    ),

  async execute(interaction, context) {
    await interaction.deferReply();

    const count = clampRecommendationCount(interaction.options.getString('count'));
    const targetUser = interaction.options.getUser('user');
    const targetUserId = targetUser?.id || null;

    const historyResult = await context.music.history(interaction.guildId, targetUserId);
    const allHistoryItems = Array.isArray(historyResult?.items) ? historyResult.items : [];

    const result = await recommendFromHistory({
      historyItems: allHistoryItems,
      count,
      fetchPopularByKeyword,
      searchTracks: (query) => context.music.searchTracks(query),
      region: 'KR',
    });

    console.log('[recommand] history tag frequencies(top15):', (result.tagFrequencies || []).slice(0, 15));

    if (!result.ok) {
      const embed = buildEmbed('Recommendation', '추천 결과가 없습니다.', '0 result(s)');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const detailEmbeds = result.items.map((track, idx) => {
      const durationText = formatDuration(track.length);
      const uriLine = track.uri || 'no url';
      const embed = new EmbedBuilder()
        .setColor(0xcd2929)
        .setTitle(`${idx + 1}. ${track.title} [${durationText}]`)
        .setDescription(`**Artist** - ${track.author || 'Unknown artist'}\n\n**URL**\n${uriLine}`)
        .setFooter({
          text: `추천 곡: ${idx + 1}/${result.items.length}`,
        });

      if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);
      return embed;
    });

    await interaction.editReply({ embeds: detailEmbeds });
  },
};
