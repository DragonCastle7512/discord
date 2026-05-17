const {
  SlashCommandBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
import { safeReply } from '../../common/reply-util';

const RESULT_LIMIT = 5;

function formatDuration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!totalSeconds) return 'Live';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getCustomIdValue(value) {
  return value?.customId || value?.custom_id || null;
}

function getTextValue(value) {
  return value?.content || value?.text || '';
}

function collectTextFromNode(node) {
  if (!node || typeof node !== 'object') return '';
  const chunks = [];
  const text = getTextValue(node);
  if (text) chunks.push(String(text));

  const children = Array.isArray(node.components) ? node.components : [];
  for (const child of children) {
    const plain = (child && typeof child.toJSON === 'function') ? child.toJSON() : child;
    const childText = collectTextFromNode(plain);
    if (childText) chunks.push(childText);
  }
  return chunks.join('\n');
}

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

function findUriByButtonCustomId(components, targetCustomId) {
  const stack = Array.isArray(components) ? [...components] : [];

  while (stack.length > 0) {
    const current = stack.pop();
    const node = (current && typeof current.toJSON === 'function') ? current.toJSON() : current;
    if (!node || typeof node !== 'object') continue;

    const accessory = node.accessory || node.accessoryComponent || node.accessory_component;
    if (accessory) {
      const accessoryCustomId = getCustomIdValue(accessory);
      if (accessoryCustomId === targetCustomId) {
        const text = collectTextFromNode(node);
        const url = extractFirstUrl(text);
        if (url) return url;
      }
      stack.push(accessory);
    }

    const children = Array.isArray(node.components) ? node.components : [];
    for (const child of children) {
      stack.push(child);
    }
  }

  return null;
}

function buildSearchComponents(query, tracks, ownerUserId) {
  const container = new ContainerBuilder();

  tracks.forEach((track, index) => {
    const info = track.info || {};
    const titleContent = `### ${index + 1}. ${info.title || 'Unknown title'}\n**Artist** - ${info.author || 'Unknown artist'}\n**Duration** - ${formatDuration(info.length)}`;
    const thumbnailSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleContent));

    if (info.artworkUrl) {
      thumbnailSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(info.artworkUrl));
    }

    const infoContent = `**URL** ${info.uri || 'no url'}`;
    const infoSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(infoContent))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(`search_play:${ownerUserId}:${index}`)
          .setLabel('Play')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!track.info?.uri),
      );

    container.addSectionComponents(thumbnailSection, infoSection);

    if (index < tracks.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
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
