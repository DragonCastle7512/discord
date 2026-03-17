const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { buildEmbed } = require('../../music/embeds/buildEmbed');

const MAX_VISIBLE = 25;
const COLLECTOR_MS = 5 * 60 * 1000;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatTitle(title, max = 80) {
  if (!title) return 'Unknown title';
  if (title.length <= max) return title;
  return `${title.slice(0, max - 3)}...`;
}

function buildDescription(tracks, selectedIndex) {
  if (!tracks.length) return 'Playlist가 비어있어요';

  const visible = tracks.slice(0, MAX_VISIBLE);
  const lines = visible.map((track, index) => {
    const title = formatTitle(track.info?.title);
    const marker = index + 1 === selectedIndex ? '>> ' : '';
    return `${marker}${index + 1}. ${title}`;
  });

  const moreCount = tracks.length - visible.length;
  const moreLine = moreCount > 0 ? `\n...그리고 ${moreCount}개 더 있음` : '';

  return `${lines.join('\n')}${moreLine}`;
}

function buildComponents(tracks, selectedIndex, userId) {
  const options = tracks.slice(0, MAX_VISIBLE).map((track, index) => ({
    label: formatTitle(track.info?.title, 95),
    value: String(index + 1),
    default: index + 1 === selectedIndex,
  }));

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`playlist-select:${userId}`)
      .setPlaceholder('조작할 노래를 선택하세요')
      .addOptions(options),
  );

  const moveUpDisabled = selectedIndex <= 1;
  const moveDownDisabled = selectedIndex >= tracks.length;

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`playlist-up:${userId}`)
      .setLabel('위로 이동')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(moveUpDisabled),
    new ButtonBuilder()
      .setCustomId(`playlist-down:${userId}`)
      .setLabel('아래로 이동')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(moveDownDisabled),
    new ButtonBuilder()
      .setCustomId(`playlist-play:${userId}`)
      .setLabel('재생')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`playlist-delete:${userId}`)
      .setLabel('삭제')
      .setStyle(ButtonStyle.Danger),
  );

  return [selectRow, buttonRow];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('플레이리스트 목록을 확인합니다.'),
  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    let tracks = await context.music.getPlaylist(userId);

    if (!tracks.length) {
      const embed = buildEmbed('PlayList', 'Playlist가 비어있어요', '0 track(s)');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let selectedIndex = 1;

    const embed = buildEmbed(
      'PlayList',
      buildDescription(tracks, selectedIndex),
      `${tracks.length} track(s)`,
    );
    const message = await interaction.editReply({
      embeds: [embed],
      components: buildComponents(tracks, selectedIndex, userId),
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({
      time: COLLECTOR_MS,
      filter: (i) => i.user.id === userId,
    });

    collector.on('collect', async (component) => {
      try {
        await component.deferUpdate();

        if (component.customId.startsWith('playlist-select:')) {
          selectedIndex = Number(component.values?.[0] || 1);
          selectedIndex = clamp(selectedIndex, 1, Math.max(1, tracks.length));
        }
        else if (component.customId.startsWith('playlist-delete:')) {
          await context.music.deleteFromPlaylist(userId, selectedIndex);
          tracks = await context.music.getPlaylist(userId);
          if (!tracks.length) {
            const emptyEmbed = buildEmbed('PlayList', 'Playlist가 비어있어요', '0 track(s)');
            await interaction.editReply({ embeds: [emptyEmbed], components: [] });
            collector.stop('empty');
            return;
          }
          selectedIndex = clamp(selectedIndex, 1, tracks.length);
        }
        else if (component.customId.startsWith('playlist-up:')) {
          if (selectedIndex > 1) {
            await context.music.movePlaylistItem(userId, selectedIndex, selectedIndex - 1);
            selectedIndex -= 1;
            tracks = await context.music.getPlaylist(userId);
          }
        }
        else if (component.customId.startsWith('playlist-play:')) {
          console.log(tracks[selectedIndex - 1].info.uri);
          await context.music.addToPlaylist(interaction.guildId, interaction.user.id, tracks[selectedIndex - 1].info.uri);
        }
        else if (component.customId.startsWith('playlist-down:')) {
          if (selectedIndex < tracks.length) {
            await context.music.movePlaylistItem(userId, selectedIndex, selectedIndex + 1);
            selectedIndex += 1;
            tracks = await context.music.getPlaylist(userId);
          }
        }

        const nextEmbed = buildEmbed(
          'PlayList',
          buildDescription(tracks, selectedIndex),
          `${tracks.length} track(s)`,
        );
        await interaction.editReply({
          embeds: [nextEmbed],
          components: buildComponents(tracks, selectedIndex, userId),
        });
      }
      catch (error) {
        console.error('Playlist component error:', error);
        if (component.deferred || component.replied) {
          await component.editReply({ content: '조작 중 오류가 발생했어요.' });
        }
        else {
          await component.reply({ content: '조작 중 오류가 발생했어요.', ephemeral: true });
        }
      }
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
          console.warn('Failed to remove playlist components on collector end:', error);
        }
      }
    });
  },
};
