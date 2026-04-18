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
  ActionRowBuilder,
} = require('discord.js');
const { handlers: musicSkillHandlers } = require('../../ai/skills/music-skill');
const {
  clampRecommendationCount,
  formatDuration,
  recommendFromHistory,
} = require('../../music/recommand-service');
import { safeReply } from '../../common/reply-util';

// 사용자별 추천 결과를 저장할 인메모리 캐시
const recommendationCache = new Map();

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

function buildRecommendationComponents(tracks, ownerUserId, startIndex = 0) {
  const chunkSize = 5;
  const currentChunk = tracks.slice(startIndex, startIndex + chunkSize);
  const container = new ContainerBuilder();

  currentChunk.forEach((track, chunkIdx) => {
    const displayIdx = startIndex + chunkIdx;

    const titleContent = `### ${displayIdx + 1}. ${track.title || 'Unknown title'}\n**Artist** - ${track.author || 'Unknown artist'}\n**Duration** - ${formatDuration(track.length)}`;
    const thumbnailSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleContent));

    if (track.artworkUrl) {
      thumbnailSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.artworkUrl));
    }

    const infoContent = `**URL** ${track.uri || 'no url'}`;
    const infoSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(infoContent))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(`recommand_play:${ownerUserId}:${displayIdx}`)
          .setLabel('Play')
          .setStyle(ButtonStyle.Primary),
      );

    container.addSectionComponents(thumbnailSection, infoSection);

    if (chunkIdx < currentChunk.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
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

    // 실제 추천 API 호출
    const result = await recommendFromHistory({
      historyItems: allHistoryItems,
      count,
      fetchPopularByKeyword,
      searchTracks: (query) => context.music.searchTracks(query),
      region: 'KR',
    });

    // 결과를 캐시에 저장 (사용자 ID 기준)
    recommendationCache.set(interaction.user.id, result);

    if (!result || (Array.isArray(result) && result.length === 0)) {
      await safeReply(interaction, { content: '추천 결과가 없어요.' });
      return;
    }

    await safeReply(interaction, { content: '추천 결과를 불러왔어요!' });

    // 첫 페이지(index 0) 표시
    const components = buildRecommendationComponents(result, interaction.user.id, 0);
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
      const cachedResult = recommendationCache.get(ownerUserId);

      if (!cachedResult) {
        await safeReply(interaction, {
          content: '캐시된 추천 결과가 없어요. `/recommand`를 다시 실행해 주세요.',
          ephemeral: true,
        });
        return;
      }

      const components = buildRecommendationComponents(cachedResult, ownerUserId, startIndex);
      await interaction.update({
        flags: MessageFlags.IsComponentsV2,
        components,
      });
    }
  },
};
