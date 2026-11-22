import { config } from '../config.js';
import { withAuthorizedRoleMutation, isMemberUnderAuthorityReview } from './roleIntegrity.js';
import { getRoleBranches, normalizeMemberRoles, planRoleChange, roleFamily, validateRoleBranchConfig } from './roleBranchPolicy.js';
import type { RoleOperation } from './roleBranchPolicy.js';
import type { ChatInputCommandInteraction, Guild, GuildMember, Role } from 'discord.js';

const pending = new Map<string, Promise<unknown>>();

export async function withRoleLock<T>(
  guildId: string,
  userId: string,
  callback: () => Promise<T>
): Promise<T> {
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

const roleIdsOf = (member: GuildMember): string[] =>
  [...member.roles.cache.keys()].filter(id => id !== member.guild.id);

const sameIds = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every(id => b.has(id));

async function fetchFresh(guild: Guild, userId: string): Promise<GuildMember> {
  return guild.members.fetch({ user: userId, force: true, cache: true });
}

async function commitRoles(
  member: GuildMember,
  desiredIds: Set<string>,
  reason: string,
  actorId: string | null = null
): Promise<GuildMember> {
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

export async function applyRoleBranchOperation(
  interaction: ChatInputCommandInteraction<'cached'>,
  member: GuildMember,
  { mode, fromRole = null, toRole = null, reason, guard }: {
    mode: RoleOperation;
    fromRole?: Role | null;
    toRole?: Role | null;
    reason: string;
    guard: (member: GuildMember, role?: Role) => string | null | undefined;
  }
) {
  return withRoleLock(interaction.guildId, member.id, async () => {
    const current = await fetchFresh(interaction.guild, member.id);
    const refusal = guard(current);
    if (refusal) throw new Error(refusal);
    const planned = planRoleChange(roleIdsOf(current), {
      mode,
      fromId: fromRole?.id ?? null,
      toId: toRole?.id ?? null,
      owner: current.id === interaction.guild.ownerId,
      ownerSelfIndependent: current.id === interaction.guild.ownerId &&
        current.id === interaction.user.id && ['add', 'remove'].includes(mode) &&
        Boolean(toRole && roleFamily(toRole.id) === null),
    });
    const requiredIds = [...new Set([...planned.added, ...planned.removed])];
    const changedRoles: Role[] = [];

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
      addedRoles: planned.added.map(id => changedRoles.find(role => role.id === id)),
    };
  });
}

export async function reconcileRoleBranches(
  member: GuildMember,
  { source = 'member-update' }: { source?: string } = {}
) {
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
      const bot = fresh.guild.members.me ?? await fresh.guild.members.fetchMe();
      if (role.position >= bot.roles.highest.position) {
        throw new Error('Cannot reconcile role at or above bot: ' + role.name);
      }
    }

    await commitRoles(fresh, plan.roles, 'Opus role-branch policy: ' + source, fresh.guild.client?.user?.id ?? null);
    console.info('[role-branch] corrected', fresh.id, JSON.stringify({
      source, removed: plan.removed, added: plan.added,
    }));
    return { status: 'corrected', ...plan };
  });
}

export async function reconcileAllRoleBranches(guild: Guild) {
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
      console.error('[role-branch] startup reconcile failed:', member.id, error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}
