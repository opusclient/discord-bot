import { Events } from 'discord.js';
import { evaluateRoleDefinitionUpdate } from '../services/roleIntegrity.js';

export const name = Events.GuildRoleUpdate;

export async function execute(previous, role) {
  await evaluateRoleDefinitionUpdate(previous, role).catch(error =>
    console.error('[OAI] Role update evaluation failed:', role.id, error.message)
  );
}
