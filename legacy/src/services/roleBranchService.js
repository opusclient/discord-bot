import { config } from '../config.js';
import { withAuthorizedRoleMutation, isMemberUnderAuthorityReview } from './roleIntegrity.js';
import { getRoleBranches, normalizeMemberRoles, planRoleChange, roleFamily, validateRoleBranchConfig } from './roleBranchPolicy.js';

const pending = new Map();

export async function withRoleLock(guildId, userId, callback) {
  const key = guildId + ':' + userId;
  const previous = pending.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(callback);
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}

const roleIdsOf = member => [...member.roles.cache.keys()].filter(id => id !== member.guild.id);
const sameIds = (a, b) => a.size === b.size && [...a].every(id => b.has(id));

async function fetchFresh(guild, userId) {
  return guild.members.fetch({ user: userId, force: true, cache: true });
}

async function commitRoles(member, desiredIds, reason, actorId = null) {
  const before = new Set(roleIdsOf(member));
  if (sameIds(before, desiredIds)) return member;
  await withAuthorizedRoleMutation(member, { action: 'set', roles: [...desiredIds], reason, actorId, lock: false });
  const confirmed = await fetchFresh(member.guild, member.id);
  const actual = new Set(roleIdsOf(confirmed));
  if (!sameIds(actual, desiredIds)) {
    throw new Error('Discord role assignment did not match the verified target state.');
  }
  return confirmed;
}

export async function applyRoleBranchOperation(interaction, member, { mode, fromRole = null, toRole = null, reason, guard }) {
  return withRoleLock(interaction.guildId, member.id, async () => {
    const current = await fetchFresh(interaction.guild, member.id);
    const refusal = guard(current);
    if (refusal) throw new Error(refusal);
    const planned = planRoleChange(roleIdsOf(current), {
      mode, fromId: fromRole?.id ?? null, toId: toRole?.id ?? null,
      owner: current.id === interaction.guild.ownerId,
      ownerSelfIndependent: current.id === interaction.guild.ownerId &&
        current.id === interaction.user.id && ['add', 'remove'].includes(mode) &&
        toRole && roleFamily(toRole.id) === null
    });
    const requiredIds = [...new Set([...planned.added, ...planned.removed])];
    const changedRoles = [];
    for (const id of requiredIds) {
      const role = interaction.guild.roles.cache.get(id) ??
        await interaction.guild.roles.fetch(id).catch(() => null);
      if (!role) throw new Error('Role no longer exists: ' + id);
      const problem = guard(current, role);
      if (problem) throw new Error(problem);
      if (role.managed) throw new Error('Managed role cannot be changed: ' + role.name);
      changedRoles.push(role);
    }
    await commitRoles(current, planned.roles, reason, interaction.user.id);
    return {
      ...planned,
      removedRoles: planned.removed.map(id => changedRoles.find(role => role.id === id)),
      addedRoles: planned.added.map(id => changedRoles.find(role => role.id === id))
    };
  });
}

export async function reconcileRoleBranches(member, { source = 'member-update' } = {}) {
  if (!member || member.user?.bot || member.guild.id !== config.guildId ||
      member.id === member.guild.ownerId) {
    return { status: 'ignored' };
  }
  if (isMemberUnderAuthorityReview(member.guild.id, member.id)) return { status: 'authority-review' };
  return withRoleLock(member.guild.id, member.id, async () => {
    if (isMemberUnderAuthorityReview(member.guild.id, member.id)) return { status: 'authority-review' };
    const fresh = await fetchFresh(member.guild, member.id);
    const current = roleIdsOf(fresh);
    const plan = normalizeMemberRoles(current);
    if (!plan.changed) return { status: 'unchanged' };
    const roleCache = fresh.guild.roles.cache;
    for (const id of [...plan.added, ...plan.removed]) {
      const role = roleCache.get(id) ?? await fresh.guild.roles.fetch(id).catch(() => null);
      if (!role || role.managed) throw new Error('Cannot reconcile inaccessible role: ' + id);
      if (role.position >= fresh.guild.members.me.roles.highest.position) {
        throw new Error('Cannot reconcile role at or above bot: ' + role.name);
      }
    }
    await commitRoles(fresh, plan.roles, 'Opus role-branch policy: ' + source, fresh.guild.client?.user?.id ?? null);
    console.info('[role-branch] corrected', fresh.id, JSON.stringify({
      source, removed: plan.removed, added: plan.added
    }));
    return { status: 'corrected', ...plan };
  });
}

export async function reconcileAllRoleBranches(guild) {
  if (!guild || guild.id !== config.guildId) return { status: 'ignored' };
  await guild.roles.fetch();
  validateRoleBranchConfig(guild.roles.cache, getRoleBranches());
  const members = await guild.members.fetch();
  const result = { scanned: 0, corrected: 0, unchanged: 0, failed: 0 };
  for (const member of members.values()) {
    if (member.user.bot || member.id === guild.ownerId) continue;
    result.scanned++;
    try {
      const outcome = await reconcileRoleBranches(member, { source: 'startup-audit' });
      if (outcome.status === 'corrected') result.corrected++;
      else result.unchanged++;
    } catch (error) {
      result.failed++;
      console.error('[role-branch] startup reconcile failed:', member.id, error.message);
    }
  }
  return result;
}
