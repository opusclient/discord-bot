import { registerAuthorityMemberDeparture } from '../services/roleIntegrity.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { revokeOverlayAccess } from '../services/overlayBridge.js';
import { inviteTracker } from '../services/inviteTracker.js';

export const name = Events.GuildMemberRemove;

export function execute(member) {
  if (member.guild.id !== config.guildId) return;
  registerAuthorityMemberDeparture(member);
  try { inviteTracker.onLeave(member); } catch (error) { console.error('[invites] Leave tracking failed:', error.message); }
  revokeOverlayAccess(member.id);
}
