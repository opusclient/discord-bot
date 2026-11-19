import { Events } from 'discord.js';
import { config } from '../config.js';
import { applyMuteOverwrite } from '../services/mutes.js';

export const name = Events.ChannelUpdate;

export async function execute(previous, channel) {
  if (!channel.guild || channel.guild.id !== config.guildId || previous.parentId === channel.parentId) return;
  if (!config.muteRoleId) return;
  const role = await channel.guild.roles.fetch(config.muteRoleId).catch(() => null);
  if (!role) return;
  await applyMuteOverwrite(channel, role, 'Update mute restrictions after channel category change').catch(error =>
    console.error('[channelUpdate] Failed to reconcile mute permissions:', error.message));
}
