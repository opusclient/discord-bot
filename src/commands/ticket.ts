import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getOpenTicketByOwner } from '../db.js';
import { buildTicketPanelPayload, TICKET_TYPES } from '../services/tickets.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { execute as add } from '../ticket-actions/add.js';
import { execute as remove } from '../ticket-actions/remove.js';
import { execute as close } from '../ticket-actions/close.js';
import { execute as claim } from '../ticket-actions/claim.js';
import { execute as rename } from '../ticket-actions/rename.js';
import { execute as permanentAdd } from '../ticket-actions/permanentRoleAdd.js';
import { execute as permanentRemove } from '../ticket-actions/permanentRoleRemove.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Open, manage and close support tickets')
  .addSubcommand(s => s.setName('open').setDescription('Show the ticket category panel'))
  .addSubcommand(s => s.setName('status').setDescription('Show your most recent open ticket'))
  .addSubcommand(s => s.setName('add').setDescription('Grant a user or role access to this ticket')
    .addUserOption(o => o.setName('user').setDescription('User to add'))
    .addRoleOption(o => o.setName('role').setDescription('Role to add'))
    .addStringOption(o => o.setName('scope').setDescription('Apply to this ticket or every ticket (role only)')
      .addChoices({ name: 'Current ticket', value: 'ticket' }, { name: 'All tickets (permanent)', value: 'all' })))
  .addSubcommand(s => s.setName('remove').setDescription('Revoke a user or role access to this ticket')
    .addUserOption(o => o.setName('user').setDescription('User to remove'))
    .addRoleOption(o => o.setName('role').setDescription('Role to remove'))
    .addStringOption(o => o.setName('scope').setDescription('Apply to this ticket or every ticket (role only)')
      .addChoices({ name: 'Current ticket', value: 'ticket' }, { name: 'All tickets (permanent)', value: 'all' })))
  .addSubcommand(s => s.setName('close').setDescription('Close this ticket and save its transcript')
    .addStringOption(o => o.setName('reason').setDescription('Optional closing reason').setMaxLength(500)))
  .addSubcommand(s => s.setName('claim').setDescription('Claim or unclaim this ticket'))
  .addSubcommand(s => s.setName('rename').setDescription('Rename this ticket')
    .addStringOption(o => o.setName('name').setDescription('New ticket label').setRequired(true).setMaxLength(90)));

const actions = { add, remove, close, claim, rename };

export async function execute(interaction: ChatInputCommandInteraction<'cached'>, client: Client) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'open') {
    const payload = buildTicketPanelPayload(interaction.guildId);
    await interaction.reply({ ...payload, flags: visibilityFlags(interaction) });
    return;
  }
  if (sub === 'status') {
    const ticket = getOpenTicketByOwner(interaction.guildId, interaction.user.id);
    if (!ticket) {
      await interaction.reply({
        embeds: [infoEmbed('Your Tickets', 'You have no open support tickets. Use /ticket open to create one.')],
        flags: visibilityFlags(interaction)
      });
      return;
    }
    const label = TICKET_TYPES[ticket.type as keyof typeof TICKET_TYPES]?.label ?? 'General';
    const number = String(ticket.ticket_number ?? ticket.id).padStart(4, '0');
    await interaction.reply({
      embeds: [infoEmbed('Your Active Ticket', '**#' + number + '** · ' + label + '\n<#' + ticket.channel_id + '>')],
      flags: visibilityFlags(interaction)
    });
    return;
  }
  if (sub === 'add' || sub === 'remove') {
    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');
    const scope = interaction.options.getString('scope') ?? 'ticket';
    if (user && role) {
      await interaction.reply({
        embeds: [errorEmbed('Choose either a user or a role, not both.')],
        flags: visibilityFlags(interaction)
      });
      return;
    }
    if (scope === 'all') {
      if (!role || user) {
        await interaction.reply({
          embeds: [errorEmbed('Permanent ticket staff access requires a role, not an individual user.')],
          flags: visibilityFlags(interaction)
        });
        return;
      }
      await (sub === 'add' ? permanentAdd : permanentRemove)(interaction);
      return;
    }
  }
  const action = actions[sub as keyof typeof actions];
  if (action) await (action as (interaction: ChatInputCommandInteraction<'cached'>, client: Client) => Promise<unknown>)(interaction, client);
}
