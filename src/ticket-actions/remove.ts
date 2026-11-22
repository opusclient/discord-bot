import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags } from 'discord.js';
import { getTicketForChannel, isTicketStaff, removeFromTicket } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  if (!user && !role) {
    return interaction.reply({
      embeds: [errorEmbed('Pick a `user` or a `role` to remove (at least one).')],
      flags: visibilityFlags(interaction),
    });
  }

  const ticket = getTicketForChannel(interaction.guildId, interaction.channelId);
  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: visibilityFlags(interaction) });
  }
  if (!isTicketStaff(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed('Only ticket staff can remove access from this ticket.')],
      flags: visibilityFlags(interaction),
    });
  }

  if (user) {
    if (user.id === ticket.owner_id) {
      return interaction.reply({ embeds: [errorEmbed('The ticket owner cannot be removed from their own ticket.')], flags: visibilityFlags(interaction) });
    }
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const result = await removeFromTicket(interaction.guild, ticket, member ?? user, interaction.member);
    if (result?.error) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], flags: visibilityFlags(interaction) });
    }
    return interaction.reply({ embeds: [successEmbed(`<@${user.id}> no longer has access to this ticket.`)], flags: visibilityFlags(interaction) });
  }

  if (!role) return interaction.reply({ embeds: [errorEmbed('Select a role.')], flags: visibilityFlags(interaction) });
  const result = await removeFromTicket(interaction.guild, ticket, role, interaction.member);
  if (result?.error) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], flags: visibilityFlags(interaction) });
  }
  return interaction.reply({
    embeds: [successEmbed(`The role <@&${role.id}> no longer has access to this ticket.`)],
    flags: visibilityFlags(interaction),
  });
}
