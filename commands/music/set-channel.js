import { safeReply } from '../../common/reply-util';
import { GuildConfig } from '../../music/models/guild-config';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-music-channel')
    .setDescription('노래 알림 메시지를 수신할 전용 텍스트 채널을 설정합니다.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('알림을 보낼 텍스트 채널')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guild.id;

    try {
      const config = await GuildConfig.findOne({ where: { guildId } });
      if (config) {
        await config.update({ musicChannelId: channel.id });
      }
      else {
        await GuildConfig.create({ guildId, musicChannelId: channel.id });
      }

      await safeReply(interaction, `성공적으로 노래 재생 알림 채널을 ${channel}로 지정하였습니다!`);
    }
    catch (error) {
      console.error(error);
      await safeReply(interaction, '설정 도중 오류가 발생했습니다.');
    }
  },
};
