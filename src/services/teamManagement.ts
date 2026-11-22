import { config } from '../config.js';
import { roleFamily } from './roleBranchPolicy.js';
import type { RoleFamily } from './roleBranchPolicy.js';

type RoleReference = { id: string };

type RoleContext = {
  user: { id: string };
  guild: { ownerId: string };
  member?: {
    roles?: { cache?: { has(id: string): boolean } };
  } | null;
};

const memberHas = (interaction: RoleContext, id: string): boolean =>
  Boolean(id && interaction.member?.roles?.cache?.has?.(id));

export function isTeamManagementRole(role: RoleReference | null | undefined): boolean {
  return Boolean(role && (
    role.id === config.staffManagementRoleId ||
    role.id === config.developmentManagementRoleId
  ));
}

export function isFounder(interaction: RoleContext): boolean {
  return interaction.user.id === interaction.guild.ownerId;
}

export function isManagerPlus(interaction: RoleContext): boolean {
  return isFounder(interaction) || memberHas(interaction, config.roleBranches.manager);
}

export function canManageBranch(interaction: RoleContext, family: RoleFamily | null): boolean {
  if (isFounder(interaction)) return true;
  if (family === 'staff') {
    return memberHas(interaction, config.roleBranches.manager) ||
      memberHas(interaction, config.staffManagementRoleId);
  }
  if (family === 'development') {
    return memberHas(interaction, config.roleBranches.principal) ||
      memberHas(interaction, config.developmentManagementRoleId);
  }
  return false;
}

export function roleOperationScope(
  fromRole: RoleReference | null | undefined,
  toRole: RoleReference | null | undefined
): RoleFamily | null {
  return (fromRole && roleFamily(fromRole.id)) ||
    (toRole && roleFamily(toRole.id)) ||
    null;
}

export function teamManagementPermissionError(
  interaction: RoleContext,
  fromRole: RoleReference | null | undefined,
  toRole: RoleReference | null | undefined
): string | null {
  if (fromRole?.id === config.developmentManagementRoleId ||
      toRole?.id === config.developmentManagementRoleId) {
    return isFounder(interaction)
      ? null
      : 'Only Founder may assign or revoke Development Management.';
  }
  if (fromRole?.id === config.staffManagementRoleId ||
      toRole?.id === config.staffManagementRoleId) {
    return isManagerPlus(interaction)
      ? null
      : 'Only Founder or Manager may assign or revoke Staff Management.';
  }
  const scope = roleOperationScope(fromRole, toRole);
  if (scope && !canManageBranch(interaction, scope)) {
    return scope === 'staff'
      ? 'Staff branch management requires Staff Management, Manager or Founder.'
      : 'Development branch management requires Development Management, Principal Engineer or Founder.';
  }
  return null;
}

export function isEligibleForManagementRole(roleId: string, roleIds: Iterable<string>): boolean {
  const ids = new Set(roleIds);
  const policy = config.roleBranches;
  if (roleId === config.staffManagementRoleId) {
    return [policy.staff[2], policy.development[0], policy.development[1]]
      .some(id => ids.has(id));
  }
  if (roleId === config.developmentManagementRoleId) {
    return ids.has(policy.manager);
  }
  return true;
}

export function managementEligibilityError(
  role: RoleReference | null | undefined,
  roleIds: Iterable<string>
): string | null {
  if (!role || !isTeamManagementRole(role)) return null;
  if (isEligibleForManagementRole(role.id, roleIds)) return null;
  return role.id === config.staffManagementRoleId
    ? 'Staff Management can be assigned only to Adminstrator or a Development team member.'
    : 'Development Management can be assigned only to a Manager. Principal Engineer already has this authority automatically.';
}
