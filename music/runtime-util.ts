import { Client } from 'discord.js';
import { Shoukaku } from 'shoukaku';
import { GuildState, RuntimeUtils } from './types';
import { createPlayerEngine } from './services/player-engine';

export function createRuntimeUtils(deps: {
  client: Client;
  shoukaku: Shoukaku;
  readyNodes: Set<string>;
  allowSoundCloudFallback: boolean;
  lavalinkReadyTimeoutMs: number;
  guildStates: Map<string, GuildState>;
}): RuntimeUtils {
  return createPlayerEngine(deps);
}
