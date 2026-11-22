import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags } from 'discord.js';
import { claimTicket, getTicketForChannel } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';

export async function execute(interaction, client, action = 'toggle') {
  const ticket = getTicketForChannel(interaction.guildId, interaction.channelId);
  if (!ticket) {
    await interaction.reply({embeds:[errorEmbed('This channel is not an open ticket.')],flags:visibilityFlags(interaction)});
    return;
  }
  await interaction.deferReply({flags:visibilityFlags(interaction)});
  const result = await claimTicket(interaction.guild,ticket,interaction.member,client,action);
  const embed = result.error ? errorEmbed(result.error) :
    successEmbed(result.claimed ? 'You claimed this ticket.' : 'You unclaimed this ticket.');
  await interaction.editReply({embeds:[embed]});
}
