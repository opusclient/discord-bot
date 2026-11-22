import { visibilityFlags } from '../utils/visibility.js';
import type { ChatInputCommandInteraction, GuildMember, Role } from 'discord.js';
import type { RoleOperation } from './roleBranchPolicy.js';
import type { RoleOperationRecord } from './roleEmbeds.js';

type ParsedTargets =
  | { error: string; ids?: never }
  | { ids: string[]; error?: never };

import { MessageFlags, PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { errorEmbed, truncate } from '../utils/embeds.js';
import { buildRoleNotification, buildRoleOperationResult, ROLE_RESULTS_PER_PAGE } from './roleEmbeds.js';
import { paginateInteraction } from '../utils/paginate.js';
import { sendModLog } from './log.js';
import { applyRoleBranchOperation } from './roleBranchService.js';
import { getRoleBranches, roleFamily } from './roleBranchPolicy.js';
import { developmentAccessPermissionError } from './developmentAccess.js';
import {
  isTeamManagementRole, isManagerPlus, teamManagementPermissionError,
  roleOperationScope
} from './teamManagement.js';
import { recordTeamRoleChange } from './teamRoleHistory.js';
import { ensureBotPermissions, ensureModerator, roleAssignabilityError } from '../utils/permissions.js';

export const MAX_ROLE_TARGETS = 50;

export function parseUserList(input: unknown): ParsedTargets {
  const entries = String(input ?? '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  if (!entries.length) return { error: 'Enter at least one user ID or mention.' };
  if (entries.length > MAX_ROLE_TARGETS) return { error: 'You can target at most ' + MAX_ROLE_TARGETS + ' users at once.' };
  const ids: string[] = [];
  for (const entry of entries) {
    const id = entry.match(/^<@!?(\d{17,20})>$/)?.[1] ??
      (/^\d{17,20}$/.test(entry) ? entry : null);
    if (!id) return { error: 'Invalid user ID or mention: ' + truncate(entry, 45) + '. Separate users with commas.' };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids };
}

export function targetRoleError(interaction: ChatInputCommandInteraction<'cached'>, member: GuildMember, { mode = null, toRole = null }: { mode?: RoleOperation | null; toRole?: Role | null } = {}): string | null {
  const me = interaction.guild.members.me;
  if (!me) return 'Bot member is unavailable.';
  const self = member.id === interaction.user.id;
  if (member.id === me.id) return 'The bot cannot modify its own roles.';
  if (self) {
    const managerPlus = interaction.user.id === interaction.guild.ownerId ||
      interaction.member.roles.cache.has(config.roleBranches.manager);
    if (!managerPlus) return 'Only Manager or Founder can change their own roles.';
    if (!['add', 'remove'].includes(mode ?? '') || !toRole || roleFamily(toRole.id) !== null ||
        isTeamManagementRole(toRole)) {
      return 'Manager+ can change only ordinary independent functional roles on themselves, not team ranks or management delegation.';
    }
  }
  if (member.id === interaction.guild.ownerId && !self) return 'The server owner cannot be modified.';
  if (member.roles.highest.position >= me.roles.highest.position) return 'The target is at or above the bot in the role hierarchy.';
  if (!self && interaction.user.id !== interaction.guild.ownerId &&
      member.roles.highest.position >= interaction.member.roles.highest.position) {
    return 'The target is at or above your role hierarchy.';
  }
  return null;
}

export function manageableRoleError(interaction: ChatInputCommandInteraction<'cached'>, role: Role, { indirect = false }: { indirect?: boolean } = {}): string | null {
  const managementError = !indirect && isTeamManagementRole(role)
    ? teamManagementPermissionError(interaction, null, role) : null;
  if (managementError) return managementError;
  const restricted = !indirect && developmentAccessPermissionError(interaction, role);
  if (restricted) return restricted;
  const error = roleAssignabilityError(interaction.guild, role);
  if (error) return error;
  if (!interaction.guild.members.me) return 'Bot member is unavailable.';
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    return 'The role is at or above the bot in the role hierarchy.';
  }
  if (interaction.user.id !== interaction.guild.ownerId &&
      role.position >= interaction.member.roles.highest.position) {
    return 'The role is at or above your role hierarchy.';
  }
  return null;
}

export async function executeRoleOperation(interaction: ChatInputCommandInteraction<'cached'>, mode: RoleOperation) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  if (!(await ensureBotPermissions(interaction, PermissionsBitField.Flags.ManageRoles, 'Manage Roles'))) return;
  const parsed = parseUserList(interaction.options.getString('users', true));
  if (!parsed.ids) return interaction.editReply({ embeds: [errorEmbed(parsed.error ?? 'Invalid user list')] });

  const transition = mode === 'promote' || mode === 'demote';
  const targetRole = mode === 'demote'
    ? interaction.options.getRole('to_role')
    : interaction.options.getRole(transition ? 'to_role' : 'role', true);
  const explicitFrom = transition
    ? interaction.options.getRole('from_role', mode === 'demote')
    : null;
  if (mode === 'demote' && !explicitFrom) {
    return interaction.editReply({ embeds: [errorEmbed('Specify from_role to demote a member.')] });
  }
  const managementError = teamManagementPermissionError(interaction, explicitFrom, targetRole);
  if (managementError) {
    return interaction.editReply({ embeds: [errorEmbed(managementError)] });
  }
  const scope = roleOperationScope(explicitFrom, targetRole);
  if (!scope && !isTeamManagementRole(targetRole) && !isTeamManagementRole(explicitFrom) &&
      !(await ensureModerator(interaction, PermissionsBitField.Flags.ManageRoles, 'Manage Roles',
        { modRoleAllowed: false }))) return;
  for (const role of [targetRole, explicitFrom].filter((role): role is Role => Boolean(role))) {
    const problem = manageableRoleError(interaction, role);
    if (problem) return interaction.editReply({ embeds: [errorEmbed(problem)] });
  }
  const reason = interaction.options.getString('reason')?.trim() || null;
  const outcome: { success: string[]; skipped: string[]; dmFailed: string[]; records: RoleOperationRecord[] } = {
    success: [], skipped: [], dmFailed: [], records: []
  };
  const audit = truncate((reason || mode) + ' | ' + mode + ' by ' + interaction.user.id, 500);
  const fail = (id: string, name: string, error: string): void => {
    outcome.skipped.push(id + ': ' + error);
    outcome.records.push({
      id, name, status: 'failed', error, fromRole: explicitFrom,
      toRole: targetRole, removedRoles: [], addedRoles: [], dmDelivered: false
    });
  };

  for (const id of parsed.ids) {
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) {
      fail(id, id, 'Member is not in this server.');
      continue;
    }
    const name = member.displayName || member.user.globalName ||
      member.user.username || member.user.id;
    const memberError = targetRoleError(interaction, member, { mode, toRole: targetRole });
    if (memberError) {
      fail(id, name, memberError);
      continue;
    }
    if (transition && member.user.bot) {
      fail(id, name, 'Staff transitions can only be applied to member accounts.');
      continue;
    }
    try {
      const plan = await applyRoleBranchOperation(interaction, member, {
        mode,
        fromRole: explicitFrom,
        toRole: targetRole,
        reason: audit,
        guard: (current, changedRole) => changedRole
          ? manageableRoleError(interaction, changedRole, {
            indirect: changedRole.id !== targetRole?.id && changedRole.id !== explicitFrom?.id
          })
          : targetRoleError(interaction, current, { mode, toRole: targetRole })
      });
      const branches = getRoleBranches();
      const rankedIds = [...branches.staff, ...branches.development];
      const regularMember = !rankedIds.some(roleId => plan.roles.has(roleId));
      const record: RoleOperationRecord = {
        id, name, status: 'success', fromRole: explicitFrom,
        toRole: targetRole, removedRoles: plan.removedRoles,
        addedRoles: plan.addedRoles, family: plan.family,
        regularMember, dmDelivered: false
      };
      if (transition) {
        try {
          recordTeamRoleChange({
            guildId: interaction.guildId,
            userId: id,
            moderatorId: interaction.user.id,
            mode,
            branch: plan.family,
            fromRole: explicitFrom,
            toRole: targetRole,
            addedRoles: plan.addedRoles,
            removedRoles: plan.removedRoles,
            reason,
            interactionId: interaction.id
          });
          record.historySaved = true;
        } catch (error) {
          record.historySaved = false;
          console.error('[role-history] Could not save completed role change:', id, (error instanceof Error ? error.message : String(error)));
        }
      }
      outcome.success.push(id);
      try {
        await member.user.send(buildRoleNotification({
          member,
          fromRole: explicitFrom,
          toRole: targetRole,
          removedRoles: plan.removedRoles,
          addedRoles: plan.addedRoles,
          family: plan.family,
          regularMember,
          mode,
          guild: interaction.guild,
          moderator: interaction.user,
          reason,
          referenceId: interaction.id
        }));
        record.dmDelivered = true;
      } catch {
        outcome.dmFailed.push(id);
      }
      outcome.records.push(record);
    } catch (error) {
      fail(id, name, truncate((error instanceof Error ? error.message : String(error)), 190));
    }
  }

  const summary = {
    mode,
    guild: interaction.guild,
    moderator: interaction.user,
    reason,
    records: outcome.records,
    referenceId: interaction.id
  };
  const pages = Math.max(1, Math.ceil(outcome.records.length / ROLE_RESULTS_PER_PAGE));
  if (outcome.success.length) {
    for (let page = 0; page < pages; page++) {
      await sendModLog(interaction.guild, buildRoleOperationResult({
        ...summary, page, audit: true
      }));
    }
  }
  await paginateInteraction(interaction, {
    totalPages: pages,
    render: page => buildRoleOperationResult({ ...summary, page })
  });
  return outcome;
}
