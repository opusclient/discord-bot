import { Events } from 'discord.js';
import { config } from '../config.js';
import { onProtectedLogChannelDeleted } from '../services/logIntegrity.js';

export const name = Events.ChannelDelete;

export async function execute(channel, client) {
  if (!channel?.guild || channel.guild.id !== config.guildId) return;
  await onProtectedLogChannelDeleted(channel, client).catch(error =>
    console.error('[log-integrity] Protected channel recovery failed:', error.message));
}
