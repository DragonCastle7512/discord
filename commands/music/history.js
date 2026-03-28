const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

function formatTitle(title, max = 80) {
  if (!title) return 'Unknown title';
  if (title.length <= max) return title;
  return `${title.slice(0, max - 3)}...`;
}

function formatPlayedAt(playedAt) {
  if (!playedAt) return '날짜 없음';
  const date = new Date(playedAt);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('최근 재생한 음악 목록을 확인합니다')
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription(`표시할 곡 수 (1~${MAX_LIMIT}, 기본값 ${DEFAULT_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT),
    ),
  async execute(interaction, context) {
    const limit = interaction.options.getInteger('limit') || DEFAULT_LIMIT;
    const result = context.music.history(interaction.guildId, limit);

    if (!result.count) {
      const empty = buildEmbed('History', '최근 재생한 음악이 없습니다.', '0 track(s)');
      await interaction.reply({ embeds: [empty] });
      return;
    }

    const lines = result.items.map((track) => {
      const title = formatTitle(track?.info?.title);
      const playedAt = formatPlayedAt(track?.playedAt);
      return `**[ ${playedAt} ]**\n* ${title}\n`;
    });

    const embed = buildEmbed(
      'History',
      lines.join('\n'),
      `${result.count} track(s)${result.total > result.count ? ` / total ${result.total}` : ''}`,
    );

    await interaction.reply({ embeds: [embed] });
  },
};
