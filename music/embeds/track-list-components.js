const {
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
} = require('discord.js');

/**
 * 트랙 길이를 포맷팅합니다. (ms -> m:ss)
 */
function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '?:??';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 트랙 정보를 일관된 형식으로 변환합니다.
 */
function normalizeTrackInfo(track) {
  const info = track.info || track || {};
  return {
    title: info.title || 'Unknown title',
    author: info.author || 'Unknown artist',
    length: info.length || 0,
    uri: info.uri || 'no url',
    artworkUrl: info.artworkUrl || null,
  };
}

/**
 * 긴 제목을 줄입니다.
 */
function formatTitle(title, max = 80) {
  if (!title) return 'Unknown title';
  if (title.length <= max) return title;
  return `${title.slice(0, max - 3)}...`;
}

/**
 * 단일 트랙에 대한 섹션 쌍(썸네일 섹션, 정보/버튼 섹션)을 생성합니다.
 */
function createTrackSectionPair({
  track,
  displayIdx,
  userId,
  customIdPrefix,
  buttonLabel = 'Play',
  buttonStyle = ButtonStyle.Primary,
}) {
  const info = normalizeTrackInfo(track);
  const itemIndex = displayIdx + 1;

  const titleContent = `### ${itemIndex}. ${formatTitle(info.title)}\n**Artist** - ${info.author} \n**Duration** - ${formatDuration(info.length)}`;

  const thumbnailSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleContent));

  if (info.artworkUrl) {
    thumbnailSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(info.artworkUrl));
  }

  const infoContent = `**URL** ${info.uri}`;
  const infoSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(infoContent))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:${userId}:${displayIdx}`)
        .setLabel(buttonLabel)
        .setStyle(buttonStyle)
        .setDisabled(!info.uri || info.uri === 'no url'),
    );

  return [thumbnailSection, infoSection];
}

/**
 * 트랙 목록을 위한 ContainerBuilder를 생성합니다.
 */
function buildTrackListContainer({
  tracks,
  startIndex = 0,
  userId,
  customIdPrefix,
  selectedIndex = -1,
  accentColor = 0xcd2929,
}) {
  const container = new ContainerBuilder();

  if (selectedIndex !== -1 && (selectedIndex > startIndex && selectedIndex <= startIndex + tracks.length)) {
    container.setAccentColor(accentColor);
  }

  tracks.forEach((track, index) => {
    const displayIdx = startIndex + index;
    const sections = createTrackSectionPair({
      track,
      displayIdx,
      userId,
      customIdPrefix,
    });

    container.addSectionComponents(...sections);

    if (index < tracks.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
  });

  return container;
}

/**
 * 컴포넌트 트리에서 특정 버튼의 customId에 해당하는 트랙 URI를 찾습니다.
 */
function findUriByButtonCustomId(components, targetCustomId) {
  const stack = Array.isArray(components) ? [...components] : [];

  while (stack.length > 0) {
    const current = stack.pop();
    const node = (current && typeof current.toJSON === 'function') ? current.toJSON() : current;
    if (!node || typeof node !== 'object') continue;

    // Components V2 액세서리 확인
    const accessory = node.accessory || node.accessoryComponent || node.accessory_component;
    if (accessory) {
      const accessoryCustomId = accessory.customId || accessory.custom_id;
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

function collectTextFromNode(node) {
  if (!node || typeof node !== 'object') return '';
  const chunks = [];
  const text = node.content || node.text || '';
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

module.exports = {
  normalizeTrackInfo,
  formatTitle,
  createTrackSectionPair,
  buildTrackListContainer,
  findUriByButtonCustomId,
};
