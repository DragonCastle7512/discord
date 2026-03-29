const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

const PAGE_SIZE = 6;
const COLLECTOR_MS = 3 * 60 * 1000;

function formatTitle(title, max = 80) {
  if (!title) return 'Unknown title';
  if (title.length <= max) return title;
  return `${title.slice(0, max - 3)}...`;
}

function formatPlayedAt(createdAt) {
  if (!createdAt) return '날짜 없음';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDescription(items, page) {
  const start = page * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  return pageItems.map((track) => {
    const title = formatTitle(track?.musicInfo?.info?.title);
    const playedAt = formatPlayedAt(track?.createdAt);
    return `> ${playedAt}\n* **${title}**`;
  }).join('\n');
}

function buildComponents(page, totalPages, userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`history-prev:${userId}`)
        .setLabel('이전 페이지')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`history-next:${userId}`)
        .setLabel('다음 페이지')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    ),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('최근 재생한 음악 목록을 확인합니다'),
  async execute(interaction, context) {
    const result = await context.music.history(interaction.guildId);

    if (!result.total) {
      const empty = buildEmbed('History', '최근 재생한 음악이 없습니다.', '0 track(s)');
      await interaction.reply({ embeds: [empty] });
      return;
    }

    const items = result.items;
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    let page = 0;
    const userId = interaction.user.id;

    const embed = buildEmbed(
      'History',
      buildDescription(items, page),
      `${result.total} track(s) | Page ${page + 1}/${totalPages}`,
    );

    const message = await interaction.reply({
      embeds: [embed],
      components: buildComponents(page, totalPages, userId),
      fetchReply: true,
    });

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({ time: COLLECTOR_MS });

    collector.on('collect', async (component) => {
      // if (component.user.id !== userId) {
      //   await component.reply({ content: 'Only the command user can change pages.', ephemeral: true });
      //   return;
      // }

      if (component.customId === `history-prev:${userId}` && page > 0) {
        page -= 1;
      }
      else if (component.customId === `history-next:${userId}` && page < totalPages - 1) {
        page += 1;
      }

      const nextEmbed = buildEmbed(
        'History',
        buildDescription(items, page),
        `${result.total} track(s) | Page ${page + 1}/${totalPages}`,
      );

      await component.update({
        embeds: [nextEmbed],
        components: buildComponents(page, totalPages, userId),
      });
    });

    collector.on('end', async () => {
      try {
        await interaction.deleteReply();
      }
      catch (error) {
        if (message.deletable) {
          await message.delete();
        }
        else {
          console.warn('Failed to disable history pagination buttons:', error);
        }
      }
    });
  },
};
