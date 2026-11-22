import { Events } from 'discord.js';
import { config } from '../config.js';
import { inviteTracker } from '../services/inviteTracker.js';

export const name = Events.InviteDelete;

export function execute(invite) {
  if (invite.guild?.id === config.guildId) inviteTracker.onDelete(invite);
}
