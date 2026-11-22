import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { inviteTracker } from '../services/inviteTracker.js';

export const name = Events.InviteCreate;

export function execute(invite: ClientEvents['inviteCreate'][0]) {
  if (invite.guild?.id === config.guildId) inviteTracker.onCreate(invite);
}
