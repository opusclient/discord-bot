import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { INSTALL_DELAYING_STATUSES, buildSetupSummaryEmbed, runInstall } from '../services/install.js';
import { ensureBotPermissions, ensureBotController } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('install')
  .setDescription('Refresh Opus System panels and runtime notices without changing server roles');

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });

  if (!(await ensureBotController(interaction))) return;
  if (!(await ensureBotPermissions(interaction, PermissionsBitField.Flags.ManageRoles, 'Manage Roles'))) return;

  const results = await runInstall(client, interaction.guild, { installerId: interaction.user.id });
  const pending = results.filter((r) => INSTALL_DELAYING_STATUSES.has(r.status)).length;

  await interaction.editReply({
    embeds: [
      buildSetupSummaryEmbed(results, {
        title: 'Install',
        description: pending
          ? 'Setup finished with open items - check the entries below.'
          : 'Setup complete. The setup messages were posted/refreshed in the configured channels.',
        report: true,
      }),
    ],
  });
}
