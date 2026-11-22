import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import type { ChatInputCommandInteraction, Role } from 'discord.js';
import { config } from '../config.js';
import { buildAuditEmbed, errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { visibilityFlags } from '../utils/visibility.js';
import { sendModLog } from '../services/log.js';
import { isManagerPlus } from '../services/teamManagement.js';
import {
  customRoleNameExists,
  getCustomRole,
  listCustomRoles,
  parseRoleColor,
  recordCustomRole,
  untrackCustomRole,
  validateCustomRoleName
} from '../services/customRoles.js';

export const data = new SlashCommandBuilder()
  .setName('customrole')
  .setDescription('Manage custom color roles')
  .addSubcommand(sub => sub
    .setName('create')
    .setDescription('Create a custom color role')
    .addStringOption(option => option.setName('name').setDescription('Name of the custom role').setMinLength(1).setMaxLength(100).setRequired(true))
    .addStringOption(option => option.setName('color').setDescription('Six-digit hex color, e.g. #7C3AED').setMinLength(6).setMaxLength(7).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('delete')
    .setDescription('Permanently delete a tracked custom color role')
    .addRoleOption(option => option.setName('role').setDescription('Existing custom role to delete').setRequired(true))
    .addBooleanOption(option => option.setName('confirm').setDescription('Confirm permanent deletion, including removal from all members').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List custom color roles managed by Opus System')
    .addIntegerOption(option => option.setName('page').setDescription('Page number').setMinValue(1)));

async function logChange(interaction: ChatInputCommandInteraction<'cached'>, title: string, roleId: string, roleName: string, color: string) {
  await sendModLog(interaction.guild, buildAuditEmbed({
    title,
    description: [
      'Role: ' + escapeMarkdown(roleName),
      'Role ID: `' + roleId + '`',
      'Color: `' + color + '`',
      'Actor ID: `' + interaction.user.id + '`'
    ].join('\n')
  }));
}

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  if (!isManagerPlus(interaction)) {
    return interaction.editReply({ embeds: [errorEmbed('Only Founder or Manager can manage custom color roles.')] });
  }

  const mode = interaction.options.getSubcommand();
  if (mode === 'list') {
    const requested = interaction.options.getInteger('page') ?? 1;
    const result = listCustomRoles(interaction.guildId, { page: requested });
    if (requested > result.pages) {
      return interaction.editReply({ embeds: [errorEmbed('There are only ' + result.pages + ' page(s) of custom roles.')] });
    }
    if (!result.total) {
      return interaction.editReply({ embeds: [infoEmbed('Custom roles', 'No custom color roles have been created yet.')] });
    }
    const lines = result.roles.map((row, index) => {
      const role = interaction.guild.roles.cache.get(row.role_id);
      const status = role ? '' : ' | missing from server';
      const color = '#' + Number(row.color).toString(16).toUpperCase().padStart(6, '0');
      return '`' + String((result.page - 1) * 10 + index + 1).padStart(2, '0') + '` ' +
        (role ? escapeMarkdown(role.name) : escapeMarkdown(row.role_name)) +
        ' | `' + color + '` | `' + row.role_id + '`' + status;
    });
    return interaction.editReply({
      embeds: [infoEmbed('Custom roles | Page ' + result.page + '/' + result.pages, lines.join('\n'))
        .setFooter({ text: result.total + ' custom role(s) | Roles are not hoisted or publicly mentionable' })]
    });
  }

  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply({ embeds: [errorEmbed('Opus System needs Manage Roles to perform this action.')] });
  }

  if (mode === 'create') {
    const parsedName = validateCustomRoleName(interaction.options.getString('name', true));
    if (!parsedName.value) return interaction.editReply({ embeds: [errorEmbed(parsedName.error ?? 'Invalid role name.')] });
    const color = parseRoleColor(interaction.options.getString('color', true));
    if (color.value === undefined) return interaction.editReply({ embeds: [errorEmbed(color.error ?? 'Invalid role color.')] });
    const name = parsedName.value;

    if (customRoleNameExists(interaction.guildId, name) ||
        interaction.guild.roles.cache.some(role => role.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return interaction.editReply({ embeds: [errorEmbed('A role with this name already exists. Choose a unique name.')] });
    }

    const role = await interaction.guild.roles.create({
      name,
      color: color.value,
      permissions: 0n,
      hoist: false,
      mentionable: false,
      reason: 'Custom color role created by ' + interaction.user.id
    });
    try {
      recordCustomRole({
        guildId: interaction.guildId,
        roleId: role.id,
        name: role.name,
        color: color.value,
        createdBy: interaction.user.id
      });
    } catch (error) {
      await role.delete('Rollback untracked custom color role').catch(() => null);
      throw error;
    }
    await logChange(interaction, 'Custom role created', role.id, role.name, color.hex);
    return interaction.editReply({
      embeds: [successEmbed('Created **' + escapeMarkdown(role.name) + '** with color `' + color.hex +
        '`.\nRole ID: `' + role.id + '`\nDisplay separately: `Off` | Mentionable: `Off` | Permissions: `None`',
      'Custom role created')]
    });
  }

  if (mode === 'delete') {
    if (!interaction.options.getBoolean('confirm', true)) {
      return interaction.editReply({ embeds: [errorEmbed('Deletion cancelled. Set `confirm: true` only when you want to permanently remove the role.')] });
    }
    const role = interaction.options.getRole('role', true) as Role;
    const tracked = getCustomRole(interaction.guildId, role.id);
    if (!tracked) {
      return interaction.editReply({ embeds: [errorEmbed('This role is not registered as a custom color role. Staff, system and other roles are protected.')] });
    }
    if (role.managed || role.id === interaction.guildId || role.position >= me.roles.highest.position) {
      return interaction.editReply({ embeds: [errorEmbed('The bot cannot delete this role due to role hierarchy or Discord restrictions.')] });
    }
    if (interaction.user.id !== interaction.guild.ownerId &&
        role.position >= interaction.member.roles.highest.position) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot delete a role at or above your own role hierarchy.')] });
    }
    const label = role.name;
    const color = '#' + Number(tracked.color).toString(16).toUpperCase().padStart(6, '0');
    await role.delete('Custom color role deleted by ' + interaction.user.id);
    untrackCustomRole(interaction.guildId, role.id);
    await logChange(interaction, 'Custom role deleted', role.id, label, color);
    return interaction.editReply({
      embeds: [successEmbed('Deleted custom role **' + escapeMarkdown(label) +
        '** (`' + role.id + '`).\nThe role was removed from every member who held it.', 'Custom role deleted')]
    });
  }

  return interaction.editReply({ embeds: [errorEmbed('Unsupported custom role operation.')] });
}
