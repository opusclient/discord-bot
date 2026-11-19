import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { createCase, getActiveCases } from '../db.js';
import { logCase } from '../services/log.js';
import { buildCaseEmbed, errorEmbed } from '../utils/embeds.js';
import { canModerateMember, ensureModerator } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Record a user in the Opus blacklist')
  .addUserOption(o => o.setName('user').setDescription('User to blacklist').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for blacklisting').setRequired(true).setMaxLength(500));

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  if (!(await ensureModerator(interaction, PermissionsBitField.Flags.ManageGuild, 'Manage Server', { modRoleAllowed: false }))) return;
  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member && !(await canModerateMember(interaction, member))) return;
  if (getActiveCases(interaction.guildId, user.id, 'blacklisted').length) {
    await interaction.editReply({ embeds: [errorEmbed('This user already has an active blacklist case.')] });
    return;
  }
  const caseRow = createCase({
    guildId: interaction.guildId,
    userId: user.id,
    moderatorId: interaction.user.id,
    type: 'blacklisted',
    reason: interaction.options.getString('reason', true)
  });
  await logCase(interaction.guild, caseRow, { clientId: client.user.id });
  await interaction.editReply({
    embeds: [buildCaseEmbed(caseRow, { clientId: client.user.id }).setDescription(
      'Blacklist record created for <@' + user.id + '>.\nNo automatic enforcement is enabled yet.\nReason: ' + caseRow.reason
    )]
  });
}
