import { config } from '../config.js';

export function isDevelopmentAccessRole(role) {
  return Boolean(role && (
    role.name === 'Development Access' ||
    (config.developmentAccessRoleId && role.id === config.developmentAccessRoleId)
  ));
}

export function canManageDevelopmentAccess(interaction) {
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return Boolean(interaction.member?.roles?.cache?.has?.(config.roleBranches?.manager));
}

export function developmentAccessPermissionError(interaction, role) {
  if (!isDevelopmentAccessRole(role)) return null;
  if (canManageDevelopmentAccess(interaction)) return null;
  return 'Only Founder or Manager can grant or remove Development Access.';
}
