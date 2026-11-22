import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags } from 'discord.js';
import { getTicketForChannel, isTicketStaff, renameTicket } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export async function execute(interaction) {
  const ticket = getTicketForChannel(interaction.guildId, interaction.channelId);
  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: visibilityFlags(interaction) });
  }
  if (!isTicketStaff(interaction.member, ticket)) {
    return interaction.reply({
      embeds: [errorEmbed('Only ticket staff can rename this ticket.')],
      flags: visibilityFlags(interaction),
    });
  }

  const name = interaction.options.getString('name').trim();
  const result = await renameTicket(interaction.guild, ticket, name, interaction.member);
  const embed = result?.error ? errorEmbed(result.error) : successEmbed(`Ticket renamed.`);

  return interaction.reply({ embeds: [embed], flags: visibilityFlags(interaction) });
}
