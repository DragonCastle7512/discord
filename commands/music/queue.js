const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const PAGE_SIZE = 10;
const CUSTOM_PREFIX = 'qctl';

function truncate(text, maxLength = 90) {
  if (!text) return '제목 없음';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '?:??';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function clampPage(page, totalPages) {
  if (!Number.isInteger(page) || page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

function parseCustomId(customId) {
  if (!customId || !customId.startsWith(`${CUSTOM_PREFIX}|`)) return null;
  const parts = customId.split('|');
  if (parts.length < 3) return null;

  if (parts[1] === 'sel') {
    const page = Number(parts[2]);
    return { type: 'select', page: Number.isInteger(page) ? page : 1 };
  }

  if (parts[1] === 'btn') {
    const action = parts[2];
    const page = Number(parts[3]);
    const selectedIndex = Number(parts[4]);
    return {
      type: 'button',
      action,
      page: Number.isInteger(page) ? page : 1,
      selectedIndex: Number.isInteger(selectedIndex) && selectedIndex > 0 ? selectedIndex : null,
    };
  }

  return null;
}

function buildQueueView(snapshot, state = {}) {
  const queueLength = snapshot.queue.length;
  const totalPages = Math.max(1, Math.ceil(queueLength / PAGE_SIZE));
  const page = clampPage(state.page || 1, totalPages);
  const selectedIndex = (
    Number.isInteger(state.selectedIndex) &&
    state.selectedIndex >= 1 &&
    state.selectedIndex <= queueLength
  ) ? state.selectedIndex : null;

  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageTracks = snapshot.queue.slice(start, end);

  const currentLine = snapshot.current
    ? `현재 재생: **${truncate(snapshot.current.info?.title, 120)}**`
    : '현재 재생: 없음';
  const queueLines = pageTracks.length
    ? pageTracks.map((track, idx) => {
      const queueIndex = start + idx + 1;
      const isSelected = queueIndex === selectedIndex;
      const marker = isSelected ? '>>' : '';
      const duration = formatDuration(track.info?.length);
      return `${marker} ${queueIndex}. ${truncate(track.info?.title)} [${duration}]`;
    })
    : ['(대기열이 비어 있습니다)'];

  const footer = [
    `대기열 ${queueLength}곡`,
    `페이지 ${page}/${totalPages}`,
  ].filter(Boolean).join(' | ');

  const embed = new EmbedBuilder()
    .setColor(0xcd2929)
    .setTitle('Queue')
    .setDescription(`${currentLine}\n\n${queueLines.join('\n')}`)
    .setFooter({ text: footer })
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${CUSTOM_PREFIX}|sel|${page}`)
    .setPlaceholder('이 페이지에서 곡 선택')
    .setDisabled(pageTracks.length === 0);

  if (pageTracks.length === 0) {
    select.addOptions([{
      label: '대기열이 비어 있습니다',
      value: '0',
      description: '/play로 곡을 추가하세요',
    }]);
  }
  else {
    select.addOptions(pageTracks.map((track, idx) => {
      const queueIndex = start + idx + 1;
      return {
        label: truncate(track.info?.title || '제목 없음', 100),
        value: String(queueIndex),
        description: `대기열 #${queueIndex}`,
        default: queueIndex === selectedIndex,
      };
    }));
  }

  const selectRow = new ActionRowBuilder().addComponents(select);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|prev|${page}|${selectedIndex || 0}`)
      .setLabel('이전')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|next|${page}|${selectedIndex || 0}`)
      .setLabel('다음')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|refresh|${page}|${selectedIndex || 0}`)
      .setLabel('새로고침')
      .setStyle(ButtonStyle.Primary),
  );

  const canControl = Boolean(selectedIndex);
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|top|${page}|${selectedIndex || 0}`)
      .setLabel('맨 위')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canControl || selectedIndex === 1),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|up|${page}|${selectedIndex || 0}`)
      .setLabel('위로')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canControl || selectedIndex === 1),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|down|${page}|${selectedIndex || 0}`)
      .setLabel('아래로')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canControl || selectedIndex === queueLength),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|bottom|${page}|${selectedIndex || 0}`)
      .setLabel('맨 아래')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canControl || selectedIndex === queueLength),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_PREFIX}|btn|remove|${page}|${selectedIndex || 0}`)
      .setLabel('제거')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canControl),
  );

  return {
    embeds: [embed],
    components: [selectRow, navRow, controlRow],
    page,
    selectedIndex,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('재생 대기열을 확인하고 순서를 제어합니다'),
  async execute(interaction, context) {
    const snapshot = context.music.getQueueSnapshot(interaction.guildId);
    const view = buildQueueView(snapshot, { page: 1 });
    await interaction.reply(view);
  },
  async handleComponent(interaction, context) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return false;

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: '서버에서만 사용할 수 있어요.', ephemeral: true });
      return true;
    }

    if (parsed.type === 'select') {
      const selected = Number(interaction.values?.[0]);
      const selectedIndex = Number.isInteger(selected) && selected > 0 ? selected : null;
      const snapshot = context.music.getQueueSnapshot(guildId);
      const view = buildQueueView(snapshot, { page: parsed.page, selectedIndex });
      await interaction.update(view);
      return true;
    }

    let nextPage = parsed.page;
    let selectedIndex = parsed.selectedIndex;
    let shouldFollowSelection = true;

    if (parsed.action === 'prev') {
      nextPage -= 1;
      shouldFollowSelection = false;
    }
    else if (parsed.action === 'next') {
      nextPage += 1;
      shouldFollowSelection = false;
    }
    else if (parsed.action !== 'refresh') {
      const state = context.music.getQueueSnapshot(guildId);
      const queueLength = state.queue.length;
      if (!selectedIndex || selectedIndex < 1 || selectedIndex > queueLength) {
        shouldFollowSelection = false;
      }
      else if (parsed.action === 'top') {
          const result = context.music.moveQueueItem(guildId, selectedIndex, 1);
          selectedIndex = result.ok ? 1 : selectedIndex;
        }
        else if (parsed.action === 'up') {
          const target = Math.max(1, selectedIndex - 1);
          const result = context.music.moveQueueItem(guildId, selectedIndex, target);
          selectedIndex = result.ok ? target : selectedIndex;
        }
        else if (parsed.action === 'down') {
          const target = Math.min(queueLength, selectedIndex + 1);
          const result = context.music.moveQueueItem(guildId, selectedIndex, target);
          selectedIndex = result.ok ? target : selectedIndex;
        }
        else if (parsed.action === 'bottom') {
          const result = context.music.moveQueueItem(guildId, selectedIndex, queueLength);
          selectedIndex = result.ok ? queueLength : selectedIndex;
        }
        else if (parsed.action === 'remove') {
          const result = context.music.removeQueueItem(guildId, selectedIndex);
          if (result.ok) {
            const afterLength = Math.max(0, queueLength - 1);
            if (afterLength === 0) {
              selectedIndex = null;
            }
            else if (selectedIndex > afterLength) {
              selectedIndex = afterLength;
            }
          }
        }
    }

    const snapshot = context.music.getQueueSnapshot(guildId);
    if (shouldFollowSelection && selectedIndex) {
      const selectedPage = Math.ceil(selectedIndex / PAGE_SIZE);
      if (selectedPage > 0) {
        nextPage = selectedPage;
      }
    }
    const view = buildQueueView(snapshot, { page: nextPage, selectedIndex });
    await interaction.update(view);
    return true;
  },
};
