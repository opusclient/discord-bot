import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { ensureMuteRole, applyMuteOverwritesAll } from '../services/mutes.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';
import { ensureBotPermissions, ensureBotController } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Inspect setup ownership; managed servers are configured through Opus Manager');

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });

  if (!(await ensureBotController(interaction))) return;
  if (!(await ensureBotPermissions(interaction, PermissionsBitField.Flags.ManageRoles, 'Manage Roles'))) return;

  if (config.serverManagedByOpusManager) {
    await interaction.editReply({ embeds: [successEmbed('Server roles, categories and permissions are managed by Opus Manager. Use /install to refresh Opus System panels without changing server permissions.', 'Server configuration is externally managed')] });
    return;
  }

  const guild = interaction.guild;
  const role = await ensureMuteRole(guild, { reason: `Setup by ${interaction.user.tag}` });
  const { ok, failed } = await applyMuteOverwritesAll(guild, role);

  const lines = [
    `Muted role: <@&${role.id}>`,
    `Applied restrictions to **${ok}** channel(s)${failed ? ` (${failed} failed)` : ''}.`,
    config.modLogChannelId
      ? `Mod log channel: <#${config.modLogChannelId}>`
      : 'Mod log channel: not set - add `modLogChannelId` to config.json',
    '',
    'New channels are automatically restricted. If the Muted role is deleted, the bot recreates it on the next mute.',
  ];
  if (failed) {
    lines.push('Some channels failed: make sure the bot has **Manage Roles** and its role is above the Muted role.');
  }

  await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), 'Setup complete')] });
}
