export const MANAGED_PREFIX_PATTERN = /^(?:\[(?:Owner|Manager|Dev|Developer|Admin|Mod|Moderator|Support|Staff|Artist|Tester|Creator)\]\s*)+/u;

export function stripRolePrefix(value) {
  return String(value ?? '').trim().replace(MANAGED_PREFIX_PATTERN, '').trim();
}

export function roleNicknamePrefix(member, policy) {
  if (!policy?.enabled || !Array.isArray(policy.rolePrefixes)) return null;
  for (const entry of policy.rolePrefixes) {
    if (!entry?.roleId || !/^(Owner|Manager|Dev|Admin|Mod|Support|Artist|Tester|Creator)$/.test(entry.prefix ?? '')) continue;
    if (member.roles.cache.has(entry.roleId)) return entry.prefix;
  }
  return null;
}

export function formatRoleNickname(prefix, base) {
  if (!prefix) return null;
  const original = stripRolePrefix(base);
  if (!original) return null;
  const start = `[${prefix}] `;
  const remaining = 32 - Array.from(start).length;
  return start + Array.from(original).slice(0, remaining).join('').trimEnd();
}

export function calculateRoleNickname(member, policy, baseNickname) {
  const prefix = roleNicknamePrefix(member, policy);
  if (!prefix) return null;
  const base = baseNickname ?? member.user.globalName ?? member.user.username;
  return formatRoleNickname(prefix, base);
}
