const { EmbedBuilder } = require('discord.js');

function buildEmbed(title, description, footer) {
  const color = 0xcd2929;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footer })
    .setTimestamp();
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildNowPlayingEmbed({
  title,
  uri,
  requesterId,
  durationMs,
  thumbnailUrl,
  footer,
}) {
  const color = 0xcd2929;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Now Playing...\n${title}`)
    .setFooter({ text: footer })
    .setTimestamp();

  if (thumbnailUrl) {
    embed.setImage(thumbnailUrl);
  }

  const fields = [];
  fields.push({ name: '신청자', value: `<@${requesterId}>`, inline: true });

  const duration = formatDuration(durationMs);
  if (duration) {
    fields.push({ name: '노래 길이', value: duration, inline: true });
  }

  if (uri) {
    fields.push({ name: 'URL', value: uri });
  }

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
}

module.exports = { buildEmbed, buildNowPlayingEmbed };
