import { Events } from 'discord.js';
import { evaluateRoleDefinitionDelete } from '../services/roleIntegrity.js';

export const name = Events.GuildRoleDelete;

export async function execute(role) {
  await evaluateRoleDefinitionDelete(role).catch(error =>
    console.error('[OAI] Role deletion evaluation failed:', role.id, error.message)
  );
}
