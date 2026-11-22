import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { evaluateRoleDefinitionDelete } from '../services/roleIntegrity.js';

export const name = Events.GuildRoleDelete;

export async function execute(role: ClientEvents['roleDelete'][0]) {
  await evaluateRoleDefinitionDelete(role).catch(error =>
    console.error('[OAI] Role deletion evaluation failed:', role.id, error.message)
  );
}
