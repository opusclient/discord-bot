import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags } from 'discord.js';
import { canManageTicket, closeTicket, getTicketForChannel } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export async function execute(interaction: ChatInputCommandInteraction<'cached'>, client: Client) {
  const ticket = getTicketForChannel(interaction.guildId, interaction.channelId);
  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: visibilityFlags(interaction) });
  }
  if (!canManageTicket(ticket, interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')],
      flags: visibilityFlags(interaction),
    });
  }

  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  const result = await closeTicket(
    interaction.guild,
    ticket,
    interaction.member,
    interaction.options.getString('reason'),
    client,
  );
  if (result?.error) {
    return interaction.editReply({ embeds: [errorEmbed(result.error)] });
  }
  return interaction.editReply({
    embeds: [successEmbed(`Ticket closed${interaction.options.getString('reason') ? ' with a note' : ''}. The channel has been deleted - the transcript went to the ticket log.`)],
  });
}
