import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { verifyMember, sweepVerifyPings } from '../../../services/verify.js';
import { sendSelfRolePing } from '../../../services/selfroles.js';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your membership to access Opus Client channels');

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await verifyMember(interaction);
  if (result?.error) {
    return interaction.editReply({ embeds: [errorEmbed(result.error)] });
  }
  if (result?.verified && result.member) {
    await sendSelfRolePing(result.member).catch(error =>
      console.error('[verify] Could not send self-role reminder:', error.message)
    );
    await sweepVerifyPings(result.member).catch(error =>
      console.error('[verify] Could not clear previous verification mentions:', error.message)
    );
  }
  const embed = result?.already
    ? successEmbed('You are already verified - nothing to do.', 'Already verified')
    : successEmbed('Your verification is complete.', 'Verified');
  return interaction.editReply({ embeds: [embed] });
}
