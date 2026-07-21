import { GuildConfig } from '../models/guild-config';

export async function findGuildConfig(guildId: string): Promise<GuildConfig | null> {
  return GuildConfig.findOne({ where: { guildId } });
}

export async function upsertGuildMusicChannel(guildId: string, musicChannelId: string): Promise<GuildConfig> {
  const config = await findGuildConfig(guildId);
  if (config) {
    await config.update({ musicChannelId });
    return config;
  }
  return GuildConfig.create({ guildId, musicChannelId });
}
