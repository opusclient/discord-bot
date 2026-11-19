import { config } from '../config.js';
import { roleFamily } from './roleBranchPolicy.js';

const memberHas = (interaction, id) =>
  Boolean(id && interaction.member?.roles?.cache?.has?.(id));

export function isTeamManagementRole(role) {
  return Boolean(role && (
    role.id === config.staffManagementRoleId ||
    role.id === config.developmentManagementRoleId
  ));
}

export function isFounder(interaction) {
  return interaction.user.id === interaction.guild.ownerId;
}

export function isManagerPlus(interaction) {
  return isFounder(interaction) || memberHas(interaction, config.roleBranches?.manager);
}

export function canManageBranch(interaction, family) {
  if (isFounder(interaction)) return true;
  if (family === 'staff') {
    return memberHas(interaction, config.roleBranches?.manager) ||
      memberHas(interaction, config.staffManagementRoleId);
  }
  if (family === 'development') {
    return memberHas(interaction, config.roleBranches?.principal) ||
      memberHas(interaction, config.developmentManagementRoleId) ||
      memberHas(interaction, config.roleBranches?.specialties?.[2]);
  }
  return false;
}

export function roleOperationScope(fromRole, toRole) {
  return fromRole && roleFamily(fromRole.id) ||
    toRole && roleFamily(toRole.id) ||
    null;
}

export function teamManagementPermissionError(interaction, fromRole, toRole) {
  if (isTeamManagementRole(fromRole) || isTeamManagementRole(toRole)) {
    if (!isManagerPlus(interaction)) {
      return 'Only Founder or Manager may assign or revoke management delegation roles.';
    }
    return null;
  }
  const scope = roleOperationScope(fromRole, toRole);
  if (scope && !canManageBranch(interaction, scope)) {
    return scope === 'staff'
      ? 'Staff branch management requires Staff Management, Manager or Founder.'
      : 'Development branch management requires Development Management, Principal Engineer, Discord Developer or Founder.';
  }
  return null;
}

export function isEligibleForManagementRole(roleId, roleIds) {
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

export function managementEligibilityError(role, roleIds) {
  if (!isTeamManagementRole(role)) return null;
  if (isEligibleForManagementRole(role.id, roleIds)) return null;
  return role.id === config.staffManagementRoleId
    ? 'Staff Management can be assigned only to Adminstrator or a Development team member.'
    : 'Development Management can be assigned only to a Manager. Principal Engineer already has this authority automatically.';
}
