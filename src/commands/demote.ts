import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import { executeRoleOperation } from '../services/roleOperations.js';

export const data = new SlashCommandBuilder()
  .setName('demote')
  .setDescription('Demote a staff member or return them to regular member status')
  .addStringOption(o => o.setName('users').setDescription('Comma-separated user IDs or mentions (max 50)').setRequired(true).setMaxLength(2500))
  .addRoleOption(o => o.setName('from_role').setDescription('Current staff role to remove').setRequired(true))
  .addRoleOption(o => o.setName('to_role').setDescription('Optional: lower role; omit to remove all staff roles'))
  .addStringOption(o => o.setName('reason').setDescription('Reason shown in DM and audit log').setMaxLength(500));

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  await executeRoleOperation(interaction, 'demote');
}
