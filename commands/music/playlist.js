const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { buildTrackListContainer, formatTitle } = require('../../music/embeds/track-list-components');
import { safeReply } from '../../common/reply-util';
import { logger } from '../../common/logger';

const PAGE_SIZE = 4;
const COLLECTOR_MS = 5 * 60 * 1000;

function isUnknownMessageError(error) {
  return Number(error?.code) === 10008;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildPlaylistComponents(tracks, userId, startIndex, selectedIndex) {
  const currentChunk = tracks.slice(startIndex, startIndex + PAGE_SIZE);

  const beforeChunk = [];
  const selectedChunk = [];
  const afterChunk = [];

  currentChunk.forEach((track, index) => {
    const displayIdx = startIndex + index;
    const itemIndex = displayIdx + 1;
    if (itemIndex < selectedIndex) {
      beforeChunk.push({ track, displayIdx });
    }
    else if (itemIndex === selectedIndex) {
      selectedChunk.push({ track, displayIdx });
    }
    else {
      afterChunk.push({ track, displayIdx });
    }
  });

  const containers = [];

  const addContainerForChunk = (chunk, isSelected) => {
    if (chunk.length === 0) return;
    const chunkTracks = chunk.map(c => c.track);
    const chunkStartIdx = chunk[0].displayIdx;

    const container = buildTrackListContainer({
      tracks: chunkTracks,
      startIndex: chunkStartIdx,
      userId,
      customIdPrefix: 'playlist_play_item',
      selectedIndex: isSelected ? selectedIndex : -1,
    });

    containers.push(container);
  };

  addContainerForChunk(beforeChunk, false);
  addContainerForChunk(selectedChunk, true);
  addContainerForChunk(afterChunk, false);

  const options = currentChunk.map((track, index) => ({
    label: `${startIndex + index + 1}. ${formatTitle(track.info?.title, 90)}`,
    value: String(startIndex + index + 1),
    default: (startIndex + index + 1) === selectedIndex,
  }));

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`playlist_select:${userId}`)
      .setPlaceholder('조작할 노래를 선택하세요')
      .addOptions(options),
  );

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`playlist_back:${userId}:${startIndex - PAGE_SIZE}`)
      .setLabel('이전')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(startIndex === 0),
    new ButtonBuilder()
      .setCustomId(`playlist_next:${userId}:${startIndex + PAGE_SIZE}`)
      .setLabel('다음')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(startIndex + PAGE_SIZE >= tracks.length),
    new ButtonBuilder()
      .setCustomId(`playlist_up:${userId}`)
      .setLabel('위로')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedIndex <= 1),
    new ButtonBuilder()
      .setCustomId(`playlist_down:${userId}`)
      .setLabel('아래로')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedIndex >= tracks.length),
    new ButtonBuilder()
      .setCustomId(`playlist_delete:${userId}`)
      .setLabel('삭제')
      .setStyle(ButtonStyle.Danger),
  );

  return [...containers, selectRow, controlRow];
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
      await safeReply(interaction, { content: 'Playlist가 비어있어요.', components: [] });
      return;
    }

    let startIndex = 0;
    let selectedIndex = 1;

    const message = await safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components: buildPlaylistComponents(tracks, userId, startIndex, selectedIndex),
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({
      time: COLLECTOR_MS,
      filter: (i) => i.user.id === userId,
    });

    collector.on('collect', async (component) => {
      try {
        if (component.customId.startsWith('playlist_play_item:')) {
          const [, , displayIdxStr] = component.customId.split(':');
          const track = tracks[parseInt(displayIdxStr, 10)];
          if (track) {
            await component.deferUpdate();
            await context.music.play(interaction, track.info.uri);
            await interaction.channel.send(`추가된 곡\n**${track.info.title}**`);
            return;
          }
        }

        await component.deferUpdate();

        if (component.customId.startsWith('playlist_select:')) {
          selectedIndex = Number(component.values?.[0] || 1);
        }
        else if (component.customId.startsWith('playlist_back:')) {
          startIndex = Math.max(0, startIndex - PAGE_SIZE);
          if (selectedIndex > startIndex + PAGE_SIZE || selectedIndex <= startIndex) {
             selectedIndex = startIndex + 1;
          }
        }
        else if (component.customId.startsWith('playlist_next:')) {
          startIndex = Math.min(tracks.length - 1, startIndex + PAGE_SIZE);
          if (selectedIndex <= startIndex || selectedIndex > startIndex + PAGE_SIZE) {
            selectedIndex = startIndex + 1;
          }
        }
        else if (component.customId.startsWith('playlist_delete:')) {
          await context.music.deleteFromPlaylist(userId, selectedIndex);
          tracks = await context.music.getPlaylist(userId);
          if (!tracks.length) {
            await safeReply(interaction, { content: 'Playlist가 비어있어요.', components: [] });
            collector.stop('empty');
            return;
          }
          selectedIndex = clamp(selectedIndex, 1, tracks.length);
          if (selectedIndex <= startIndex) startIndex = Math.max(0, startIndex - PAGE_SIZE);
        }
        else if (component.customId.startsWith('playlist_up:')) {
          if (selectedIndex > 1) {
            await context.music.movePlaylistItem(userId, selectedIndex, selectedIndex - 1);
            selectedIndex -= 1;
            tracks = await context.music.getPlaylist(userId);
            if (selectedIndex <= startIndex) startIndex = Math.max(0, startIndex - PAGE_SIZE);
          }
        }
        else if (component.customId.startsWith('playlist_down:')) {
          if (selectedIndex < tracks.length) {
            await context.music.movePlaylistItem(userId, selectedIndex, selectedIndex + 1);
            selectedIndex += 1;
            tracks = await context.music.getPlaylist(userId);
            if (selectedIndex > startIndex + PAGE_SIZE) startIndex += PAGE_SIZE;
          }
        }

        await safeReply(interaction, {
          flags: MessageFlags.IsComponentsV2,
          components: buildPlaylistComponents(tracks, userId, startIndex, selectedIndex),
        });
      }
      catch (error) {
        logger.error('music', `Playlist component error: ${error instanceof Error ? error.message : String(error)}`, { error });
        await safeReply(component, { content: '조작 중 오류가 발생했어요.', ephemeral: true });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.deleteReply().catch(() => null);
      }
      catch (error) {
        if (isUnknownMessageError(error)) return;
        if (message.deletable) {
          try {
            await message.delete();
          }
          catch (deleteError) {
            if (!isUnknownMessageError(deleteError)) {
              console.warn('플레이리스트 자동 삭제 실패:', deleteError);
            }
          }
        }
      }
    });
  },
};