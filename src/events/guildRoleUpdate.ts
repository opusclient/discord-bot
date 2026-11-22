import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { evaluateRoleDefinitionUpdate } from '../services/roleIntegrity.js';

export const name = Events.GuildRoleUpdate;

export async function execute(previous: ClientEvents['roleUpdate'][0], role: ClientEvents['roleUpdate'][1]) {
  await evaluateRoleDefinitionUpdate(previous, role).catch(error =>
    console.error('[OAI] Role update evaluation failed:', role.id, error.message)
  );
}
