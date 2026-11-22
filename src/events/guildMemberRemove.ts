import type { Client, ClientEvents } from 'discord.js';
import { registerAuthorityMemberDeparture } from '../services/roleIntegrity.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { revokeOverlayAccess } from '../services/overlayBridge.js';
import { inviteTracker } from '../services/inviteTracker.js';

export const name = Events.GuildMemberRemove;

export function execute(member: ClientEvents['guildMemberRemove'][0]) {
  if (member.guild.id !== config.guildId) return;
  registerAuthorityMemberDeparture(member);
  try { inviteTracker.onLeave(member); } catch (error) { console.error('[invites] Leave tracking failed:', (error instanceof Error ? error.message : String(error))); }
  revokeOverlayAccess(member.id);
}
