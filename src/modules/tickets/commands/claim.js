import { SlashCommandBuilder } from 'discord.js';
import { execute as executeTicketClaim } from '../../../ticket-actions/claim.js';

export const data = new SlashCommandBuilder()
  .setName('claim')
  .setDescription('Claim the current support ticket');

export async function execute(interaction, client) {
  await executeTicketClaim(interaction, client, 'claim');
}
