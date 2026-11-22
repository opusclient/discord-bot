import { config } from '../config.js';
import type { GuildMember, Role } from 'discord.js';

export function isDevelopmentAccessRole(role: Role | null | undefined): boolean {
  return Boolean(role && (
    role.name === 'Development Access' ||
    (config.developmentAccessRoleId && role.id === config.developmentAccessRoleId)
  ));
}

export function canManageDevelopmentAccess(interaction: { user: { id: string }; guild: { ownerId: string }; member?: GuildMember | null }): boolean {
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return Boolean(interaction.member?.roles?.cache?.has?.(config.roleBranches?.manager));
}

export function developmentAccessPermissionError(interaction: { user: { id: string }; guild: { ownerId: string }; member?: GuildMember | null }, role: Role | null | undefined): string | null {
  if (!isDevelopmentAccessRole(role)) return null;
  if (canManageDevelopmentAccess(interaction)) return null;
  return 'Only Founder or Manager can grant or remove Development Access.';
}
