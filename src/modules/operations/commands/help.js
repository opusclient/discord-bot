import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { isModerator, isBotController } from '../../../utils/permissions.js';
import { buildHelpPanel } from '../../../services/helpPanel.js';
import { visibilityFlags } from '../../../utils/visibility.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Browse Opus System commands by category');

export function canViewStaffHelp(interaction) {
  return isBotController(interaction.member) || isModerator(interaction.member) ||
    interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageMessages) ||
    interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild) || false;
}

export async function execute(interaction, client) {
  const payload = buildHelpPanel({
    guildName: interaction.guild?.name || 'Opus Client',
    icon: interaction.guild?.iconURL?.({ size: 256 }) || client.user?.displayAvatarURL?.({ size: 256 }) || null,
    commandCount: client.commands.size,
    userId: interaction.user.id,
    isStaff: canViewStaffHelp(interaction)
  });
  await interaction.reply({ ...payload, flags: payload.flags | visibilityFlags(interaction) });
}
