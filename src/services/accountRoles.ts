import { withAuthorizedRoleMutation } from './roleIntegrity.js';
import { config } from '../config.js';
import type { Guild, GuildMember, Role } from 'discord.js';

const ids = () => ({
  verified: config.verifiedRoleId,
  unlinked: config.unlinkedRoleId,
  linked: config.linkedRoleId
});

export async function getAccountRoles(guild: Guild): Promise<{ verified: Role; unlinked: Role; linked: Role }> {
  const keys = ids();
  if (!keys.verified || !keys.unlinked || !keys.linked) {
    throw new Error('Verified, Unlinked and Linked roles must be configured by Opus Manager.');
  }
  if (new Set(Object.values(keys)).size !== 3) {
    throw new Error('Account status roles must have distinct IDs.');
  }
  const result = {} as { verified: Role; unlinked: Role; linked: Role };
  for (const [key, id] of Object.entries(keys) as Array<[keyof typeof keys, string]>) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (!role || role.managed || role.name.toLowerCase() !== key) {
      throw new Error('Configured account role is missing or mismatched: ' + key);
    }
    result[key] = role;
  }
  return result;
}

export async function completeVerification(member: GuildMember) {
  if (!member || member.user?.bot) throw new Error('Only human guild members may verify.');
  const roles = await getAccountRoles(member.guild);
  const already = member.roles.cache.has(roles.verified.id);
  const linked = member.roles.cache.has(roles.linked.id);
  const unlinked = member.roles.cache.has(roles.unlinked.id);

  if (!already) await withAuthorizedRoleMutation(member, { action: 'add', roles: roles.verified, reason: 'Verified via Opus System' });
  try {
    if (linked && unlinked) {
      await withAuthorizedRoleMutation(member, { action: 'remove', roles: roles.unlinked, reason: 'Linked takes precedence over Unlinked' });
    } else if (!linked && !unlinked) {
      await withAuthorizedRoleMutation(member, { action: 'add', roles: roles.unlinked, reason: 'New verified account has not linked Opus' });
    }
  } catch (error) {
    if (!already) {
      await withAuthorizedRoleMutation(member, { action: 'remove', roles: roles.verified, reason: 'Verification status initialization failed' }).catch(() => {});
    }
    throw error;
  }
  return { verified: !already, already, role: roles.verified, member };
}

export async function syncAccountLinkStatus(member: GuildMember, linked: boolean) {
  if (!member || member.user?.bot || typeof linked !== 'boolean') {
    throw new Error('Invalid account link status update');
  }
  const roles = await getAccountRoles(member.guild);
  if (!member.roles.cache.has(roles.verified.id)) {
    throw new Error('Account must be verified before link status can be synchronized');
  }
  const add = linked ? roles.linked : roles.unlinked;
  const remove = linked ? roles.unlinked : roles.linked;
  if (!member.roles.cache.has(add.id)) {
    await withAuthorizedRoleMutation(member, { action: 'add', roles: add, reason: 'Trusted Opus account link status confirmed' });
  }
  if (member.roles.cache.has(remove.id)) {
    await withAuthorizedRoleMutation(member, { action: 'remove', roles: remove, reason: 'Trusted Opus account link status confirmed' });
  }
  return { userId: member.id, linked, roleId: add.id };
}

export async function reconcileVerifiedMembers(guild: Guild): Promise<number> {
  const roles = await getAccountRoles(guild);
  const members = await guild.members.fetch();
  let changed = 0;
  for (const member of members.values()) {
    if (member.user?.bot || !member.roles.cache.has(roles.verified.id)) continue;
    if (member.roles.cache.has(roles.linked.id) && member.roles.cache.has(roles.unlinked.id)) {
      await withAuthorizedRoleMutation(member, { action: 'remove', roles: roles.unlinked, reason: 'Reconcile linked account status' });
      changed += 1;
    } else if (!member.roles.cache.has(roles.linked.id) && !member.roles.cache.has(roles.unlinked.id)) {
      await withAuthorizedRoleMutation(member, { action: 'add', roles: roles.unlinked, reason: 'Reconcile verified but unlinked account' });
      changed += 1;
    }
  }
  return changed;
}
