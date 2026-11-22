import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags } from 'discord.js';
import { addToTicket, getTicketForChannel, isTicketStaff } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  if (!user && !role) {
    return interaction.reply({
      embeds: [errorEmbed('Pick a `user` or a `role` to add (at least one).')],
      flags: visibilityFlags(interaction),
    });
  }
  if (user?.bot) {
    return interaction.reply({ embeds: [errorEmbed('Bot accounts cannot be added to tickets.')], flags: visibilityFlags(interaction) });
  }

  const ticket = getTicketForChannel(interaction.guildId, interaction.channelId);
  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: visibilityFlags(interaction) });
  }
  if (!isTicketStaff(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed('Only ticket staff can add people to this ticket.')],
      flags: visibilityFlags(interaction),
    });
  }

  if (user) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('That user is not in this server.')], flags: visibilityFlags(interaction) });
    }
    const result = await addToTicket(interaction.guild, ticket, member, interaction.member);
    if (result?.error) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], flags: visibilityFlags(interaction) });
    }
    return interaction.reply({ embeds: [successEmbed(`<@${user.id}> now has access to this ticket.`)], flags: visibilityFlags(interaction) });
  }

  if (!role) return interaction.reply({ embeds: [errorEmbed('Select a role.')], flags: visibilityFlags(interaction) });
  const result = await addToTicket(interaction.guild, ticket, role, interaction.member);
  if (result?.error) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], flags: visibilityFlags(interaction) });
  }
  return interaction.reply({ embeds: [successEmbed(`The role <@&${role.id}> now has access to this ticket.`)], flags: visibilityFlags(interaction) });
}
