import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { evaluateRoleDefinitionCreate } from '../services/roleIntegrity.js';

export const name = Events.GuildRoleCreate;

export async function execute(role: ClientEvents['roleCreate'][0]) {
  await evaluateRoleDefinitionCreate(role).catch(error =>
    console.error('[OAI] Role creation evaluation failed:', role.id, error.message)
  );
}
