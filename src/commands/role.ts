import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { SlashCommandBuilder, SlashCommandStringOption, SlashCommandRoleOption } from 'discord.js';
import { executeRoleOperation } from '../services/roleOperations.js';

const userOption = (o: SlashCommandStringOption) => o.setName('users').setDescription('Comma-separated user IDs or mentions (max 50)').setRequired(true).setMaxLength(2500);
const roleOption = (o: SlashCommandRoleOption) => o.setName('role').setDescription('Role to assign or remove').setRequired(true);

export const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage a role for multiple server members')
  .addSubcommand(s => s.setName('add').setDescription('Assign a role to a list of members').addStringOption(userOption).addRoleOption(roleOption)
    .addStringOption(o => o.setName('reason').setDescription('Audit reason').setMaxLength(500)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a role from a list of members').addStringOption(userOption).addRoleOption(roleOption)
    .addStringOption(o => o.setName('reason').setDescription('Audit reason').setMaxLength(500)));

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  await executeRoleOperation(interaction, interaction.options.getSubcommand() as 'add' | 'remove');
}
