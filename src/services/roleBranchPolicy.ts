import { config } from '../config.js';

export type RoleBranches = {
  staff: string[];
  development: string[];
  specialties: string[];
  founder: string;
  manager: string;
  principal: string;
  developer: string;
};

export type RoleFamily = 'staff' | 'development';
export type RoleOperation = 'promote' | 'demote' | 'add' | 'remove';

export type RolePlanOptions = {
  mode?: RoleOperation;
  fromId?: string | null;
  toId?: string | null;
  owner?: boolean;
  ownerSelfIndependent?: boolean;
};

export type RolePlan = {
  roles: Set<string>;
  added: string[];
  removed: string[];
  family: RoleFamily | 'independent';
};

export type NormalizedRoles = {
  roles: Set<string>;
  added: string[];
  removed: string[];
  changed: boolean;
};

const distinct = (values: string[]): boolean => new Set(values).size === values.length;
const asSet = (values: Iterable<string> | null | undefined): Set<string> => new Set<string>(values ?? []);
const difference = (a: Set<string>, b: Set<string>): string[] => [...a].filter(id => !b.has(id));
const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every(id => b.has(id));

export function getRoleBranches(): RoleBranches {
  const policy = config.roleBranches;
  if (!policy || !Array.isArray(policy.staff) || !Array.isArray(policy.development) ||
      !Array.isArray(policy.specialties) || policy.staff.length !== 5 ||
      policy.development.length !== 2 || policy.specialties.length !== 3) {
    throw new Error('Role branch hierarchy is missing or incomplete');
  }
  const ids = [...policy.staff, ...policy.development, ...policy.specialties];
  if (!ids.every(id => /^\d{17,20}$/.test(id)) || !distinct(ids) ||
      policy.founder !== policy.staff[0] ||
      policy.manager !== policy.staff[1] ||
      policy.principal !== policy.development[0] ||
      policy.developer !== policy.development[1]) {
    throw new Error('Invalid role branch hierarchy configuration');
  }
  return policy;
}

export function roleFamily(id: string, policy: RoleBranches = getRoleBranches()): RoleFamily | null {
  if (policy.staff.includes(id)) return 'staff';
  if (policy.development.includes(id) || policy.specialties.includes(id)) return 'development';
  return null;
}

export function roleRank(id: string, policy: RoleBranches = getRoleBranches()): number {
  const family = roleFamily(id, policy);
  if (family === 'staff') return policy.staff.indexOf(id);
  if (family === 'development') return policy.development.indexOf(id);
  return -1;
}

export function normalizeMemberRoles(current: Iterable<string>, { owner = false, scope = null }: { owner?: boolean; scope?: RoleFamily | 'independent' | null } = {}, policy: RoleBranches = getRoleBranches()): NormalizedRoles {
  const before = asSet(current);
  const next = asSet(current);
  if (owner) {
    return { roles: next, added: [], removed: [], changed: false };
  }
  if (config.developmentAccessRoleId && next.has(config.developmentAccessRoleId) &&
      [policy.founder, policy.manager, ...policy.development, ...policy.specialties].some(id => next.has(id))) {
    next.delete(config.developmentAccessRoleId);
  }
  if (config.staffManagementRoleId && next.has(config.staffManagementRoleId) &&
      ![policy.staff[2], ...policy.development].some(id => next.has(id))) {
    next.delete(config.staffManagementRoleId);
  }
  if (config.developmentManagementRoleId && next.has(config.developmentManagementRoleId) &&
      !next.has(policy.manager)) {
    next.delete(config.developmentManagementRoleId);
  }
  const staffScope = scope === null || scope === 'staff';
  const developmentScope = scope === null || scope === 'development';
  if (staffScope) {
    if (next.has(policy.founder)) next.delete(policy.founder);
    const staff = policy.staff.filter(id => next.has(id));
    const highest = staff[0] ?? null;
    for (const id of staff) {
      if (id !== highest) next.delete(id);
    }
  }
  if (developmentScope) {
    if (next.has(policy.principal) && next.has(policy.developer)) {
      next.delete(policy.developer);
    }
    if (!next.has(policy.developer)) {
      for (const id of policy.specialties) next.delete(id);
    }
  }
  if (next.has(policy.specialties[2])) {
    for (const id of policy.staff) next.delete(id);
  }
  if (next.has(policy.manager) && (staffScope || developmentScope)) {
    for (const id of policy.staff) {
      if (id !== policy.manager) next.delete(id);
    }
    if (next.has(policy.principal) && next.has(policy.developer)) {
      next.delete(policy.developer);
      for (const id of policy.specialties) next.delete(id);
    }
    if (!next.has(policy.developer)) {
      for (const id of policy.specialties) next.delete(id);
    }
    const specialties = policy.specialties.filter(id => next.has(id));
    for (const id of specialties.slice(1)) next.delete(id);
  }
  return {
    roles: next,
    added: difference(next, before),
    removed: difference(before, next),
    changed: !sameSet(before, next)
  };
}

export function planRoleChange(current: Iterable<string>, { mode, fromId = null, toId = null, owner = false, ownerSelfIndependent = false }: RolePlanOptions = {}, policy: RoleBranches = getRoleBranches()): RolePlan {
  const before = asSet(current);
  const permittedOwnerSelf = Boolean(owner && ownerSelfIndependent &&
    ['add', 'remove'].includes(mode ?? '') && !fromId && toId && roleFamily(toId, policy) === null);
  if (owner && !permittedOwnerSelf) throw new Error('The server owner cannot be modified.');
  if (!['promote', 'demote', 'add', 'remove'].includes(mode ?? '')) throw new Error('Unsupported role operation');
  if ((mode === 'promote' || mode === 'add') && !toId) throw new Error('to_role is required.');
  if (mode === 'demote' && !fromId) throw new Error('from_role is required.');
  if (mode === 'remove' && !toId) throw new Error('role is required.');
  if (fromId && toId && fromId === toId) throw new Error('Previous and destination roles must differ.');
  if (fromId && !before.has(fromId)) throw new Error('Member does not have the source role.');
  if (mode === 'remove' && !before.has(toId ?? '')) throw new Error('Member does not have the selected role.');
  if ((mode === 'add' || (mode === 'promote' && !fromId)) && before.has(toId ?? '')) {
    throw new Error('This role is already assigned.');
  }

  if (['promote', 'demote'].includes(mode ?? '') &&
      [fromId, toId].some(id => id &&
        [config.staffManagementRoleId, config.developmentManagementRoleId].includes(id))) {
    throw new Error('Management delegation must be changed with /role add or /role remove.');
  }
  const fromFamily = fromId ? roleFamily(fromId, policy) : null;
  const toFamily = toId ? roleFamily(toId, policy) : null;
  const discordDeveloper = policy.specialties[2];
  const redundantDevelopmentAccess = config.developmentAccessRoleId &&
    toId === config.developmentAccessRoleId &&
    ['promote', 'add'].includes(mode ?? '') &&
    [policy.founder, policy.manager, ...policy.development, ...policy.specialties]
      .some(id => before.has(id));
  if (redundantDevelopmentAccess) {
    throw new Error('This member already has Development access through their team role. Development Access is redundant.');
  }
  if (mode === 'add' && toId === config.staffManagementRoleId &&
      ![policy.staff[2], ...policy.development].some(id => before.has(id))) {
    throw new Error('Staff Management requires Adminstrator or an existing Development rank.');
  }
  if (mode === 'add' && toId === config.developmentManagementRoleId &&
      !before.has(policy.manager)) {
    throw new Error('Development Management requires the Manager role; Principal Engineer already has its authority.');
  }
  if (toFamily === 'staff' && before.has(discordDeveloper)) {
    throw new Error('Discord Developer has full server authority and cannot hold a Staff branch role.');
  }

  if ((mode === 'promote' || mode === 'demote') && fromFamily && toFamily && fromFamily !== toFamily) {
    throw new Error('Staff and Development are independent branches. Use a separate command for each branch.');
  }
  if ((mode === 'promote' || mode === 'demote') && fromId && toId && fromFamily && toFamily) {
    const fromRank = roleRank(fromId, policy);
    const toRank = roleRank(toId ?? '', policy);
    if (fromRank < 0 || toRank < 0) {
      throw new Error('Specialist roles are not ranks. Use /role add or /role remove for specialties.');
    }
    if (mode === 'promote' && toRank >= fromRank) {
      throw new Error('The destination must be a higher rank in the same branch.');
    }
    if (mode === 'demote' && toRank <= fromRank) {
      throw new Error('The destination must be a lower rank in the same branch.');
    }
  }
  if (mode === 'promote' && !fromId && toFamily) {
    if (toFamily === 'staff') {
      const currentHighest = policy.staff.find(id => before.has(id));
      if (currentHighest && roleRank(toId ?? '', policy) >= roleRank(currentHighest, policy)) {
        throw new Error('The member already holds an equal or higher Staff rank. Use /demote for a lower rank.');
      }
    } else if (policy.development.includes(toId ?? '')) {
      const currentHighest = policy.development.find(id => before.has(id));
      if (currentHighest && roleRank(toId ?? '', policy) >= roleRank(currentHighest, policy)) {
        throw new Error('The member already holds an equal or higher Development rank.');
      }
    }
  }
  if (toId && (mode === 'promote' || mode === 'add') && toFamily) {
    const tier = toFamily === 'staff' ? policy.staff : policy.development;
    if (tier.includes(toId)) {
      const heldHighest = tier.find(id => before.has(id));
      if (heldHighest && roleRank(heldHighest, policy) < roleRank(toId ?? '', policy)) {
        throw new Error('The member already holds a higher rank in this branch. Use /demote.');
      }
    }
  }
  if (mode === 'demote' && fromFamily) {
    const tier = fromFamily === 'staff' ? policy.staff : policy.development;
    const heldHighest = tier.find(id => before.has(id));
    if (heldHighest && heldHighest !== fromId) {
      throw new Error('from_role must be the highest rank currently held in that branch.');
    }
  }
  if (mode === 'promote' && fromId && !fromFamily && toFamily === null) {
    throw new Error('A promotion must target a configured team role.');
  }
  if (mode === 'demote' && fromFamily && !toFamily && toId) {
    throw new Error('The destination must be a rank in the same branch.');
  }
  if (mode === 'demote' && !fromFamily && toFamily) {
    throw new Error('Cannot demote an unrelated role into the Staff or Development hierarchy.');
  }
  if (mode === 'promote' && toFamily === 'development' && policy.specialties.includes(toId ?? '') &&
      !before.has(policy.developer)) {
    throw new Error('Developer is required before assigning a specialized developer role.');
  }
  const next = asSet(before);
  const clearFamily = (family: RoleFamily): void => {
    const ids = family === 'staff' ? policy.staff :
      [...policy.development, ...policy.specialties];
    for (const id of ids) next.delete(id);
  };

  if (mode === 'remove') {
    next.delete(toId ?? '');
  } else if (mode === 'demote') {
    if (!toId) {
      if (fromFamily) clearFamily(fromFamily);
      else next.delete(fromId ?? '');
    } else {
      if (fromFamily) clearFamily(fromFamily);
      else next.delete(fromId ?? '');
      next.add(toId ?? '');
    }
  } else if (mode === 'promote') {
    if (fromId) next.delete(fromId ?? '');
    if (toFamily === 'staff') clearFamily('staff');
    if (toFamily === 'development' && policy.development.includes(toId ?? '')) clearFamily('development');
    next.add(toId ?? '');
  } else {
    next.add(toId ?? '');
    if (toFamily === 'staff') clearFamily('staff');
    if (toFamily === 'staff') next.add(toId ?? '');
  }

  if (toId && policy.specialties.includes(toId ?? '') && !next.has(policy.developer)) {
    throw new Error('Developer is required before assigning a specialized developer role.');
  }
  if (mode === 'add' && toId === policy.developer && next.has(policy.principal)) {
    throw new Error('Principal Engineer is the higher Development rank. Developer cannot be added concurrently.');
  }
  if (mode === 'add' && toId && policy.specialties.includes(toId ?? '') &&
      toId !== discordDeveloper && next.has(policy.manager)) {
    const specialistCount = policy.specialties.filter(id => next.has(id)).length;
    if (specialistCount > 1) {
      throw new Error('Manager can have at most one specialized developer role.');
    }
  }

  const normalized = normalizeMemberRoles(next, { owner: permittedOwnerSelf, scope: fromFamily ?? toFamily ?? 'independent' }, policy);
  if (toId && ['add', 'promote', 'demote'].includes(mode ?? '') && !normalized.roles.has(toId ?? '')) {
    throw new Error('The requested role conflicts with the branch hierarchy or Manager exception.');
  }
  if (mode === 'add' && normalized.roles.has(toId ?? '') && normalized.removed.includes(toId ?? '')) {
    throw new Error('Cannot assign a role that conflicts with a higher rank.');
  }
  if (sameSet(before, normalized.roles)) {
    throw new Error('No changes are required under the role-branch policy.');
  }
  return {
    roles: normalized.roles,
    added: difference(normalized.roles, before),
    removed: difference(before, normalized.roles),
    family: fromFamily ?? toFamily ?? 'independent'
  };
}

export function validateRoleBranchConfig(roles: ReadonlyMap<string, { id: string; name: string; managed: boolean }> & { find?: (predicate: (role: { id: string; name: string; managed: boolean }) => boolean) => { id: string; name: string; managed: boolean } | undefined }, policy: RoleBranches = getRoleBranches()): boolean {
  const wanted = [
    ['Founder', policy.founder],
    ['Manager', policy.manager],
    ['Adminstrator', policy.staff[2]],
    ['Moderator', policy.staff[3]],
    ['Support', policy.staff[4]],
    ['Principal Engineer', policy.principal],
    ['Developer', policy.developer],
    ['Backend Developer', policy.specialties[0]],
    ['Frontend Developer', policy.specialties[1]],
    ['Discord Developer', policy.specialties[2]]
  ];
  for (const [name, id] of wanted) {
    const role = roles.get?.(id) ?? roles.find?.(role => role.id === id);
    if (!role || role.name !== name) throw new Error('Role hierarchy mismatch: ' + name);
  }
  const ranks = [...policy.staff, ...policy.development];
  if (!ranks.every(id => {
    const r = roles.get?.(id) ?? roles.find?.(x => x.id === id);
    return r && !r.managed;
  })) throw new Error('Missing or managed ranked role');
  return true;
}
