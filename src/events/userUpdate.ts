import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { syncStaffNickname } from '../services/staffNicknames.js';

export const name = Events.UserUpdate;

export async function execute(previous: ClientEvents['userUpdate'][0], user: ClientEvents['userUpdate'][1], client: Client) {
  if (previous.globalName === user.globalName && previous.username === user.username) return;
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await syncStaffNickname(member).catch(error => console.error('[staff-nicknames] Profile update failed:', error.message));
}
