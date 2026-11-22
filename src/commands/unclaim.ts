import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import { execute as executeTicketClaim } from '../ticket-actions/claim.js';

export const data = new SlashCommandBuilder()
  .setName('unclaim')
  .setDescription('Release a support ticket claimed by you');

export async function execute(interaction: ChatInputCommandInteraction<'cached'>, client: Client) {
  await executeTicketClaim(interaction, client, 'unclaim');
}
