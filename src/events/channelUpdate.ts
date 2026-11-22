import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { applyMuteOverwrite } from '../services/mutes.js';
import { enforceProtectedLogPermissions, isProtectedLogChannel } from '../services/logIntegrity.js';

export const name = Events.ChannelUpdate;

export async function execute(previous: ClientEvents['channelUpdate'][0], channel: ClientEvents['channelUpdate'][1]) {
  if (channel.isDMBased() || previous.isDMBased()) return;
  if (!channel.guild || channel.guild.id !== config.guildId) return;
  if (isProtectedLogChannel(channel.id)) {
    await enforceProtectedLogPermissions(channel.guild).catch(error =>
      console.error('[log-integrity] Could not reapply protected channel permissions:', error.message));
  }
  if (previous.parentId === channel.parentId || !config.muteRoleId) return;
  const role = await channel.guild.roles.fetch(config.muteRoleId).catch(() => null);
  if (!role) return;
  await applyMuteOverwrite(channel, role, 'Update mute restrictions after channel category change').catch(error =>
    console.error('[channelUpdate] Failed to reconcile mute permissions:', error.message));
}
