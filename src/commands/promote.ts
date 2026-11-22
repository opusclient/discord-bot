import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import { executeRoleOperation } from '../services/roleOperations.js';

export const data = new SlashCommandBuilder()
  .setName('promote')
  .setDescription('Assign a higher staff role, optionally replacing an existing role')
  .addStringOption(o => o.setName('users').setDescription('Comma-separated user IDs or mentions (max 50)').setRequired(true).setMaxLength(2500))
  .addRoleOption(o => o.setName('to_role').setDescription('New staff role to assign').setRequired(true))
  .addRoleOption(o => o.setName('from_role').setDescription('Optional: replace this existing role instead of keeping it'))
  .addStringOption(o => o.setName('reason').setDescription('Reason shown in DM and audit log').setMaxLength(500));

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  await executeRoleOperation(interaction, 'promote');
}
