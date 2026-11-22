import { randomUUID, createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { AuditLogEvent, ChannelType, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { AuthorityDecisionStore, planRoleRestoration } from './authorityDecisions.js';

const store = new AuthorityDecisionStore(db);
const clean = values => [...new Set((values ?? []).map(String))].sort();
export function isMemberUnderAuthorityReview(guildId, memberId) {
  return Boolean(db.prepare("SELECT 1 FROM authority_incidents WHERE guild_id=? AND target_id=? AND status IN ('pending','restore_pending','restore_failed') LIMIT 1").get(guildId, memberId));
}
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
const fromMember = member => clean([...member.roles.cache.keys()].filter(id => id !== member.guild.id && !member.guild.roles.cache.get(id)?.managed));
const safe = (value, size = 120) => String(value ?? '').slice(0, size).replaceAll('\\', '\\\\').replaceAll('`', '\\`');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readyGuilds = new Set();
const busy = new Map();
const changes = new Set();
let alertId = null;
let monitor = null;
const resetMarker = new URL('../../data/authority-reset-baseline.once', import.meta.url);
export const authorityIntegrityMode = () => process.env.OPUS_AUTHORITY_MODE === 'enforce' ? 'enforce' : 'monitor';

db.exec(`
  CREATE TABLE IF NOT EXISTS authority_member_snapshots (
    guild_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    roles_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS authority_member_intents (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    actor_id TEXT,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_authority_intents_member ON authority_member_intents(guild_id, member_id, created_at);
  CREATE TABLE IF NOT EXISTS authority_member_departures (guild_id TEXT NOT NULL, member_id TEXT NOT NULL, roles_json TEXT NOT NULL, departed_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_authority_member_departures ON authority_member_departures(guild_id,member_id,departed_at);
  CREATE TABLE IF NOT EXISTS authority_baseline_epochs (
    guild_id TEXT NOT NULL,
    epoch_key TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    members INTEGER NOT NULL,
    roles INTEGER NOT NULL,
    incidents INTEGER NOT NULL,
    PRIMARY KEY(guild_id,epoch_key)
  );
  CREATE TABLE IF NOT EXISTS authority_role_snapshots (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(guild_id,role_id)
  );
`);

const getSnapshot = (guildId, memberId) => {
  const row = db.prepare('SELECT roles_json FROM authority_member_snapshots WHERE guild_id = ? AND member_id = ?').get(guildId, memberId);
  return row ? JSON.parse(row.roles_json) : null;
};
const putSnapshot = (guildId, memberId, roleIds) => db.prepare(
  'INSERT INTO authority_member_snapshots (guild_id,member_id,roles_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(guild_id,member_id) DO UPDATE SET roles_json=excluded.roles_json,updated_at=excluded.updated_at'
).run(guildId, memberId, JSON.stringify(clean(roleIds)), Date.now());
const recordIntent = (id, guildId, memberId, actorId, before, after, reason) => db.prepare(
  "INSERT INTO authority_member_intents(id,guild_id,member_id,actor_id,before_json,after_json,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'prepared',?,?)"
).run(id, guildId, memberId, actorId ?? null, JSON.stringify(before), JSON.stringify(after), reason, Date.now(), Date.now());
const markIntent = (id, status) => db.prepare('UPDATE authority_member_intents SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id);
const pendingIntent = (guildId, memberId, roles) => db.prepare(
  "SELECT * FROM authority_member_intents WHERE guild_id=? AND member_id=? AND status='prepared' ORDER BY created_at DESC LIMIT 12"
).all(guildId, memberId).some(row => same(JSON.parse(row.after_json), roles) && Date.now() - Number(row.created_at) < 10000);
const conflictSince = (incident, roleIds) => {
  const rows = db.prepare(
    "SELECT before_json, after_json FROM authority_member_intents WHERE guild_id=? AND member_id=? AND status='confirmed' AND created_at > ?"
  ).all(incident.guild_id, incident.target_id, Number(incident.created_at));
  const important = new Set(roleIds);
  return [...new Set(rows.flatMap(row => {
    const a = JSON.parse(row.before_json);
    const b = JSON.parse(row.after_json);
    return [...new Set([...a, ...b])].filter(id => important.has(id) && a.includes(id) !== b.includes(id));
  }))];
};

export function protectedRoleIds() {
  return new Set([
    ...(config.roleBranches?.staff ?? []),
    ...(config.roleBranches?.development ?? []),
    ...(config.roleBranches?.specialties ?? []),
    config.staffManagementRoleId,
    config.developmentManagementRoleId,
    config.developmentAccessRoleId,
    config.botRoleId,
    ...config.protectedRoleIds ?? []
  ].filter(Boolean));
}

function roleDefinition(role) {
  return {
    name: role.name,
    permissions: role.permissions.bitfield.toString(),
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
    managed: role.managed
  };
}

function roleSnapshot(guildId, roleId) {
  const row = db.prepare('SELECT definition_json FROM authority_role_snapshots WHERE guild_id=? AND role_id=?').get(guildId, roleId);
  return row ? JSON.parse(row.definition_json) : null;
}
function saveRoleSnapshot(role) {
  db.prepare('INSERT INTO authority_role_snapshots(guild_id,role_id,definition_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(guild_id,role_id) DO UPDATE SET definition_json=excluded.definition_json,updated_at=excluded.updated_at')
    .run(role.guild.id, role.id, JSON.stringify(roleDefinition(role)), Date.now());
}

export async function withAuthorizedRoleMutation(member, { action, roles, reason, actorId = null, lock = true }) {
  if (!['add', 'remove', 'set'].includes(action)) throw new Error('Invalid role action');
  if (authorityIntegrityMode() === 'enforce' && !readyGuilds.has(member.guild.id)) {
    throw new Error('Authority integrity has not initialized; role mutations are blocked');
  }
  const work = async () => {
    const current = await member.guild.members.fetch({ user: member.id, force: true, cache: true });
    const before = fromMember(current);
    const inputs = (Array.isArray(roles) ? roles : [roles]).map(role => String(role?.id ?? role)).filter(Boolean);
    const after = action === 'set' ? clean(inputs.filter(id => !current.guild.roles.cache.get(id)?.managed)) :
      action === 'add' ? clean([...before, ...inputs]) :
        before.filter(id => !inputs.includes(id));
    if (same(before, after)) return current;
    const id = randomUUID();
    recordIntent(id, member.guild.id, member.id, actorId, before, after, reason);
    try {
      if (action === 'set') await current.roles.set([...new Set([...after, ...[...current.roles.cache.values()].filter(r => r.managed).map(r => r.id)])], reason);
      else if (action === 'add') await current.roles.add(roles, reason);
      else await current.roles.remove(roles, reason);
      const verified = await member.guild.members.fetch({ user: member.id, force: true, cache: true });
      const actual = fromMember(verified);
      if (!same(actual, after)) throw new Error('Role authorization did not verify Discord role state');
      db.exec('BEGIN IMMEDIATE');
      try {
        const trustedBefore = getSnapshot(member.guild.id, member.id);
        const trustedAfter = !trustedBefore || action === 'set' ? after :
          action === 'add' ? clean([...trustedBefore, ...inputs]) :
            trustedBefore.filter(id => !inputs.includes(id));
        putSnapshot(member.guild.id, member.id, trustedAfter);
        markIntent(id, 'confirmed');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return verified;
    } catch (error) {
      markIntent(id, 'failed');
      throw error;
    }
  };
  if (!lock) return work();
  const key = member.guild.id + ':' + member.id;
  const previous = busy.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  busy.set(key, next);
  try { return await next; } finally { if (busy.get(key) === next) busy.delete(key); }
}

async function findActor(guild, memberId, before, after, time = Date.now()) {
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 15 }).catch(() => null);
  if (!logs) return null;
  const added = after.filter(id => !before.includes(id));
  const removed = before.filter(id => !after.includes(id));
  return [...logs.entries.values()].find(entry => {
    if (entry.targetId !== memberId || Math.abs(Number(entry.createdTimestamp) - time) >= 12000) return false;
    const add = (entry.changes ?? []).filter(c => c.key === '$add').flatMap(c => (Array.isArray(c.new) ? c.new : []).map(r => r.id));
    const remove = (entry.changes ?? []).filter(c => c.key === '$remove').flatMap(c => (Array.isArray(c.new) ? c.new : []).map(r => r.id));
    return added.every(id => add.includes(id)) && removed.every(id => remove.includes(id));
  }) ?? null;
}

function classify(before, after) {
  const ids = [...new Set([...before, ...after])].filter(id => before.includes(id) !== after.includes(id));
  const sensitive = protectedRoleIds();
  const critical = ids.some(id => sensitive.has(id));
  return { level: critical ? 3 : ids.length > 2 ? 2 : 1, changed: ids };
}

function alertChannel(guild) {
  return guild.channels.cache.get(alertId) ?? null;
}

async function alert(guild, incident, { actorId = null, description = '', buttons = true } = {}) {
  const channel = alertChannel(guild);
  if (!channel?.isTextBased()) {
    console.error('[OAI] Alert channel unavailable:', incident.id, description);
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(incident.level === 3 ? 0xdc3545 : 0xf0ad4e)
    .setTitle('OPUS AUTHORITY INTEGRITY / INCIDENT #' + incident.id)
    .setDescription('**Level:** ' + incident.level + '\n**Status:** ' + incident.status +
      '\n**Target:** ' + (incident.target_id ? '<@' + incident.target_id + '>' : 'Unknown') +
      '\n**Actor:** ' + (actorId ? '<@' + actorId + '>' : 'Unverified') +
      '\n' + safe(description, 1400))
    .setTimestamp();
  const components = buttons && ['pending', 'kept_manager'].includes(incident.status)
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('oai:keep:' + incident.id).setLabel('Keep Changes').setStyle(ButtonStyle.Secondary).setDisabled(incident.status !== 'pending'),
      new ButtonBuilder().setCustomId('oai:restore:' + incident.id).setLabel(incident.status === 'kept_manager' ? 'Founder Revert' : 'Restore Previous State').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('oai:details:' + incident.id).setLabel('View Diff').setStyle(ButtonStyle.Primary)
    )] : [];
  await channel.send({
    embeds: [embed], components,
    allowedMentions: { parse: [] }
  }).catch(error => console.error('[OAI] Alert send failed', error.message));
}

async function incidentForDrift(member, before, after, source) {
  const { level, changed } = classify(before, after);
  if (changed.length === 0) return null;
  const key = member.guild.id + ':' + member.id + ':' + Date.now() + ':' + createHash('sha256').update(JSON.stringify([before, after, source])).digest('hex').slice(0, 12);
  const actor = source === 'live' ? await findActor(member.guild, member.id, before, after) : null;
  const attributed = Boolean(actor && actor.executorId && actor.executorId !== member.guild.client.user.id);
  const incident = store.open({
    guildId: member.guild.id,
    incidentKey: key,
    level: Math.max(level, 2),
    executorId: attributed ? actor.executorId : null,
    targetId: member.id,
    beneficiaryId: member.id,
    beforeRoles: before,
    afterRoles: after,
    context: { source, severity: level, changed, auditId: actor?.id ?? null, actorAttribution: attributed ? 'verified' : 'unknown' }
  });
  return incident;
}

async function restoreMemberIncident(guild, incident, actorId) {
  if (incident.context.kind === 'role_definition') throw new Error('Role definition restoration requires dedicated review');
  const member = await guild.members.fetch({ user: incident.target_id, force: true, cache: true });
  if (!member) throw new Error('Member is no longer present');
  const changed = [...new Set([...incident.beforeRoles, ...incident.afterRoles])]
    .filter(id => incident.beforeRoles.includes(id) !== incident.afterRoles.includes(id));
  const conflicts = conflictSince(incident, changed);
  const desired = planRoleRestoration(incident, fromMember(member), { conflictRoleIds: conflicts });
  const bot = guild.members.me ?? await guild.members.fetchMe();
  for (const id of changed) {
    const role = guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
    if (!role || role.managed || role.position >= bot.roles.highest.position) {
      throw new Error('Cannot restore unavailable or higher role: ' + id);
    }
  }
  await withAuthorizedRoleMutation(member, {
    action: 'set',
    roles: desired,
    reason: 'Opus Authority Integrity incident #' + incident.id + ' restored by ' + actorId,
    actorId
  });
  const verified = await guild.members.fetch({ user: incident.target_id, force: true, cache: true });
  return { verified: same(fromMember(verified), desired) };
}

async function ensureAlertChannel(guild) {
  const existing = guild.channels.cache.find(channel => channel.name === 'security-alerts' && channel.type === ChannelType.GuildText);
  if (existing) {
    alertId = existing.id;
    return existing;
  }
  const anchor = config.auditLogChannelId
    ? await guild.channels.fetch(config.auditLogChannelId).catch(() => null)
    : null;
  const channel = await guild.channels.create({
    name: 'security-alerts',
    type: ChannelType.GuildText,
    parent: anchor?.parentId ?? undefined,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: config.roleBranches.founder, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      { id: config.roleBranches.manager, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: 'Opus Authority Integrity: dedicated security review channel'
  });
  alertId = channel.id;
  return channel;
}


export function acceptCurrentAuthorityBaseline(guild, { epochKey = 'owner-accepted-20261121' } = {}) {
  if (!guild || guild.id !== config.guildId) throw new Error('Cannot accept baseline for an unrelated guild');
  const previous = db.prepare('SELECT * FROM authority_baseline_epochs WHERE guild_id=? AND epoch_key=?').get(guild.id, epochKey);
  if (previous) return { alreadyAccepted: true, members: previous.members, roles: previous.roles, incidents: previous.incidents, acceptedAt: previous.accepted_at };
  const members = [...guild.members.cache.values()];
  const roles = [...guild.roles.cache.values()];
  const unresolved = db.prepare("SELECT id,status FROM authority_incidents WHERE guild_id=? AND status IN ('pending','restore_pending','restore_failed','kept_manager')").all(guild.id);
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const incident of unresolved) {
      db.prepare("UPDATE authority_incidents SET status='accepted_baseline',updated_at=?,decision_at=? WHERE id=?")
        .run(now, now, incident.id);
      store.appendJournal(guild.id, incident.id, 'owner_accepted_prior_state', guild.client.user.id,
        { previousStatus: incident.status, reason: 'Owner requested a fresh OAI start. Historical drift is accepted without enforcement or notification.', cutoff: now }, now);
    }
    db.prepare('DELETE FROM authority_member_snapshots WHERE guild_id=?').run(guild.id);
    db.prepare('DELETE FROM authority_role_snapshots WHERE guild_id=?').run(guild.id);
    db.prepare("UPDATE authority_member_intents SET status='failed',updated_at=? WHERE guild_id=? AND status='prepared' AND created_at <= ?")
      .run(now, guild.id, now);
    for (const role of roles) saveRoleSnapshot(role);
    for (const member of members) putSnapshot(guild.id, member.id, fromMember(member));
    db.prepare('INSERT INTO authority_baseline_epochs(guild_id,epoch_key,accepted_at,members,roles,incidents) VALUES (?,?,?,?,?,?)')
      .run(guild.id, epochKey, now, members.length, roles.length, unresolved.length);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { alreadyAccepted: false, members: members.length, roles: roles.length, incidents: unresolved.length, acceptedAt: now };
}

export async function initializeAuthorityIntegrity(guild) {
  if (!guild || guild.id !== config.guildId) return null;
  await guild.roles.fetch();
  await guild.members.fetch();
  const auditCount = db.prepare('SELECT COUNT(*) AS count FROM authority_member_snapshots WHERE guild_id=?').get(guild.id).count;
  const roleCount = db.prepare('SELECT COUNT(*) AS count FROM authority_role_snapshots WHERE guild_id=?').get(guild.id).count;
  const baseline = auditCount === 0 && roleCount === 0;
  if (!store.verifyJournal(guild.id)) throw new Error('Authority journal integrity check failed');
  await ensureAlertChannel(guild);
  if (existsSync(resetMarker)) {
    const accepted = acceptCurrentAuthorityBaseline(guild);
    unlinkSync(resetMarker);
    readyGuilds.add(guild.id);
    console.info('[OAI] Fresh baseline accepted silently:', JSON.stringify({ ...accepted, mode: authorityIntegrityMode() }));
    return { baseline: true, accepted, alertId, mode: authorityIntegrityMode() };
  }
  for (const role of guild.roles.cache.values()) {
    const expected = roleSnapshot(guild.id, role.id);
    if (!expected) {
      if (baseline) saveRoleSnapshot(role);
      else {
        const incident = await openRoleIncident(guild, role.id, 'role_created', null, roleDefinition(role), AuditLogEvent.RoleCreate);
        await alert(guild, incident, { description: 'Untracked role appeared during downtime. Founder review required.' });
      }
    } else if (JSON.stringify(expected) !== JSON.stringify(roleDefinition(role))) {
      const incident = await openRoleIncident(guild, role.id, 'role_definition', expected, roleDefinition(role), AuditLogEvent.RoleUpdate);
      await alert(guild, incident, { description: 'Role definition drift after downtime. Manual review required.' });
    }
  }
  if (!baseline) {
    for (const row of db.prepare('SELECT role_id,definition_json FROM authority_role_snapshots WHERE guild_id=?').all(guild.id)) {
      if (guild.roles.cache.has(row.role_id)) continue;
      const incident = await openRoleIncident(guild, row.role_id, 'role_deleted', JSON.parse(row.definition_json), null, AuditLogEvent.RoleDelete);
      await alert(guild, incident, { description: 'A trusted role disappeared during downtime. Original role ID cannot be recovered.' });
    }
  }
  let added = 0, drift = 0;
  for (const member of guild.members.cache.values()) {
    const actual = fromMember(member);
    const expected = getSnapshot(guild.id, member.id);
    if (!expected && (baseline || actual.length === 0)) {
      putSnapshot(guild.id, member.id, actual);
      added++;
    } else if ((!expected || !same(expected, actual)) && !pendingIntent(guild.id, member.id, actual) && !isMemberUnderAuthorityReview(guild.id, member.id)) {
      drift++;
      const incident = await incidentForDrift(member, expected ?? [], actual, 'startup');
      if (incident) await alert(guild, incident, { description: 'Changes occurred while the bot was offline or history is incomplete. Founder review required.' });
    }
  }
  readyGuilds.add(guild.id);
  console.info('[OAI] Initialized', JSON.stringify({ baseline, added, drift, alertId, mode: authorityIntegrityMode() }));
  return { baseline, added, drift, alertId };
}

export async function evaluateMemberRoleUpdate(previous, member) {
  if (member.guild.id !== config.guildId || !readyGuilds.has(member.guild.id)) return;
  const actual = fromMember(member);
  const expected = getSnapshot(member.guild.id, member.id);
  if (!expected) {
    putSnapshot(member.guild.id, member.id, actual);
    return;
  }
  if (same(expected, actual) || pendingIntent(member.guild.id, member.id, actual)) return;
  const key = member.guild.id + ':' + member.id;
  if (changes.has(key)) return;
  changes.add(key);
  try {
    await delay(900);
    const fresh = await member.guild.members.fetch({ user: member.id, force: true, cache: true });
    const updated = fromMember(fresh);
    const trusted = getSnapshot(member.guild.id, member.id);
    if (!trusted || same(trusted, updated) || pendingIntent(member.guild.id, member.id, updated)) return;
    const incident = await incidentForDrift(fresh, trusted, updated, 'live');
    if (!incident) return;
    const canAuto = authorityIntegrityMode() === 'enforce' && incident.context.changed.length <= 2;
    if (canAuto) {
      try {
        await store.autoRestore({
          incidentId: incident.id,
          botId: member.guild.client.user.id,
          restore: row => restoreMemberIncident(member.guild, row, member.guild.client.user.id)
        });
        await alert(member.guild, store.get(incident.id), {
          actorId: incident.executor_id,
          description: 'Unexpected role mutation was reverted and verified.',
          buttons: false
        });
      } catch (error) {
        await alert(member.guild, store.get(incident.id), {
          actorId: incident.executor_id,
          description: 'Automatic restoration failed: ' + safe(error.message, 500)
        });
      }
    } else {
      await alert(member.guild, incident, {
        actorId: incident.executor_id,
        description: 'Untrusted role change detected. Awaiting review; unauthorized changes have not been trusted.'
      });
    }
  } finally {
    changes.delete(key);
  }
}


const restoringRoleIds = new Set();

async function roleAuditActor(guild, roleId, action) {
  const audit = await guild.fetchAuditLogs({ type: action, limit: 12 }).catch(() => null);
  const entry = [...(audit?.entries?.values?.() ?? [])].find(e =>
    e.targetId === roleId && Math.abs(Number(e.createdTimestamp) - Date.now()) < 12000
  );
  return entry?.executorId ? { actorId: entry.executorId, auditId: entry.id } : { actorId: null, auditId: null };
}

async function restoreRoleDefinitionIncident(guild, incident, actorId) {
  const kind = incident.context.kind;
  const role = await guild.roles.fetch(incident.target_id).catch(() => null);
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (kind === 'role_deleted') throw new Error('Deleted role IDs cannot be recreated in Discord');
  if (!role || role.managed || role.position >= me.roles.highest.position) {
    throw new Error('The role cannot be restored due to Discord hierarchy or missing role');
  }
  const current = roleDefinition(role);
  if (JSON.stringify(current) !== JSON.stringify(incident.context.after)) {
    throw new Error('Role configuration changed again; manual conflict resolution required');
  }
  restoringRoleIds.add(role.id);
  try {
    if (kind === 'role_created') {
      const rows = db.prepare(
        "SELECT COUNT(*) AS n FROM authority_member_intents WHERE guild_id=? AND status='confirmed' AND (after_json LIKE ? OR before_json LIKE ?) AND created_at > ?"
      ).get(guild.id, '%"' + role.id + '"%', '%"' + role.id + '"%', incident.created_at);
      if (Number(rows?.n ?? 0) > 0) throw new Error('Later authorized operations depend on this new role');
      await role.delete('Opus Authority Integrity incident #' + incident.id + ' restored by ' + actorId);
      db.prepare('DELETE FROM authority_role_snapshots WHERE guild_id=? AND role_id=?').run(guild.id, role.id);
      return { verified: !(await guild.roles.fetch(role.id).catch(() => null)) };
    }
    const before = incident.context.before;
    if (before.position !== current.position) throw new Error('Position rollback requires Founder review of the entire hierarchy');
    await role.edit({
      name: before.name,
      permissions: before.permissions,
      color: before.color,
      hoist: before.hoist,
      mentionable: before.mentionable,
      reason: 'Opus Authority Integrity incident #' + incident.id + ' restored by ' + actorId
    });
    const verified = await guild.roles.fetch(role.id, { force: true }).catch(() => null);
    return { verified: Boolean(verified && JSON.stringify(roleDefinition(verified)) === JSON.stringify(before)) };
  } finally {
    restoringRoleIds.delete(role.id);
  }
}

async function openRoleIncident(guild, roleId, kind, before, after, action) {
  const audit = await roleAuditActor(guild, roleId, action);
  const involvedUserIds = db.prepare('SELECT member_id,roles_json FROM authority_member_snapshots WHERE guild_id=?').all(guild.id)
    .filter(row => JSON.parse(row.roles_json).includes(roleId)).map(row => row.member_id);
  const incident = store.open({
    guildId: guild.id,
    incidentKey: kind + ':' + roleId + ':' + Date.now(),
    level: 3,
    executorId: audit.actorId,
    targetId: roleId,
    beforeRoles: [],
    afterRoles: [],
    context: {
      kind,
      before,
      after,
      auditId: audit.auditId,
      involvedUserIds,
      actorAttribution: audit.actorId ? 'verified' : 'unknown'
    }
  });
  return incident;
}

export async function evaluateRoleDefinitionCreate(role) {
  if (role.guild.id !== config.guildId || !readyGuilds.has(role.guild.id)) return;
  if (restoringRoleIds.has(role.id) || roleSnapshot(role.guild.id, role.id)) return;
  const incident = await openRoleIncident(role.guild, role.id, 'role_created', null, roleDefinition(role), AuditLogEvent.RoleCreate);
  await alert(role.guild, incident, {
    actorId: incident.executor_id,
    description: 'A role was created outside the recorded OAI authorization history.'
  });
}

export async function evaluateRoleDefinitionDelete(role) {
  if (role.guild.id !== config.guildId || !readyGuilds.has(role.guild.id)) return;
  if (restoringRoleIds.has(role.id)) return;
  const before = roleSnapshot(role.guild.id, role.id);
  const incident = await openRoleIncident(role.guild, role.id, 'role_deleted', before, null, AuditLogEvent.RoleDelete);
  await alert(role.guild, incident, {
    actorId: incident.executor_id,
    description: 'A Discord role was deleted. The original role ID cannot be recreated; recovery requires Founder review.'
  });
}

export async function evaluateRoleDefinitionUpdate(previous, role, { source = 'live' } = {}) {
  if (role.guild.id !== config.guildId || !readyGuilds.has(role.guild.id)) return;
  if (restoringRoleIds.has(role.id)) return;
  const before = roleSnapshot(role.guild.id, role.id);
  const after = roleDefinition(role);
  if (!before) {
    await evaluateRoleDefinitionCreate(role);
    return;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const unresolved = db.prepare(
    "SELECT 1 FROM authority_incidents WHERE guild_id=? AND target_id=? AND status IN ('pending','restore_pending','restore_failed') LIMIT 1"
  ).get(role.guild.id, role.id);
  if (unresolved) return;
  const incident = await openRoleIncident(role.guild, role.id, 'role_definition', before, after, AuditLogEvent.RoleUpdate);
  const canAuto = source === 'live' && authorityIntegrityMode() === 'enforce' && before.position === after.position && !role.managed;
  if (canAuto) {
    try {
      await store.autoRestore({
        incidentId: incident.id,
        botId: role.guild.client.user.id,
        restore: row => restoreRoleDefinitionIncident(role.guild, row, role.guild.client.user.id)
      });
      await alert(role.guild, store.get(incident.id), {
        actorId: incident.executor_id,
        description: 'Unauthorized role configuration edit reverted and verified.',
        buttons: false
      });
      return;
    } catch (error) {
      await alert(role.guild, store.get(incident.id), {
        actorId: incident.executor_id,
        description: 'Role restoration failed: ' + safe(error.message, 500)
      });
      return;
    }
  }
  await alert(role.guild, incident, {
    actorId: incident.executor_id,
    description: 'Role definition change requires review, or automatic rollback is unavailable in the current mode.'
  });
}

export async function notifyFounderOfManagerDecision(interaction, incident, outcome, action) {
  if (interaction.user.id === interaction.guild.ownerId) return false;
  if (!interaction.member.roles.cache.has(config.roleBranches.manager)) return false;
  if (!['keep', 'restore'].includes(action)) return false;
  const owner = await interaction.client.users.fetch(interaction.guild.ownerId).catch(() => null);
  if (!owner) {
    console.warn('[OAI] Cannot notify Founder for incident #' + incident.id + ': user fetch failed');
    return false;
  }
  const result = action === 'keep' ? 'KEEP CHANGES' : 'RESTORE PREVIOUS STATE';
  const body = [
    'Opus Authority Integrity — Manager decision',
    'Incident: #' + incident.id + ' | Level ' + incident.level,
    'Manager ID: ' + interaction.user.id,
    'Decision: ' + result,
    'Status: ' + outcome.status,
    'Target ID: ' + (incident.target_id ?? 'N/A'),
    'Founder retains final authority to override Manager approval.'
  ].join('\n');
  try {
    await owner.send({ content: body, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.warn('[OAI] Founder DM delivery failed for incident #' + incident.id + ':', error.message);
    return false;
  }
}

export async function reviewAuthorityInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('oai:')) return false;
  if (interaction.guildId !== config.guildId) return false;
  if (!readyGuilds.has(interaction.guildId)) {
    await interaction.reply({ content: 'Authority Integrity is not initialized. Review actions are disabled.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const [, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const incident = store.get(id);
  if (!incident || incident.guild_id !== interaction.guildId) {
    await interaction.editReply('Incident not found.');
    return true;
  }
  if (action === 'details') {
    const text = 'Incident #' + id + '\nStatus: ' + incident.status + '\nBefore: ' + incident.beforeRoles.map(x => '<@&' + x + '>').join(', ') +
      '\nAfter: ' + incident.afterRoles.map(x => '<@&' + x + '>').join(', ') +
      '\nRole configuration: ' + JSON.stringify({ before: incident.context.before, after: incident.context.after }) +
      '\nJournal: ' + store.journal(interaction.guildId, id).map(e => e.event_type).join(' → ');
    await interaction.editReply({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }
  try {
    const ownerId = interaction.guild.ownerId;
    const isManager = interaction.member.roles.cache.has(config.roleBranches.manager);
    if (isManager && interaction.user.id !== ownerId && incident.context.kind?.startsWith('role_') &&
        interaction.member.roles.cache.has(incident.target_id)) {
      throw new Error('Manager cannot review changes to a role they hold');
    }
    if (interaction.user.id !== ownerId && incident.context.actorAttribution !== 'verified') {
      throw new Error('Executor identity unverified. Founder review required.');
    }
    if (action === 'keep') {
      if (incident.context.kind?.startsWith('role_')) {
        const role = await interaction.guild.roles.fetch(incident.target_id).catch(() => null);
        if (incident.context.kind === 'role_deleted') {
          if (role) throw new Error('Deleted role has reappeared; manual verification required');
        } else if (!role || JSON.stringify(roleDefinition(role)) !== JSON.stringify(incident.context.after)) {
          throw new Error('Role definition changed after incident; cannot keep old snapshot');
        }
      } else {
        const fresh = await interaction.guild.members.fetch({ user: incident.target_id, force: true, cache: true });
        if (!same(fromMember(fresh), incident.afterRoles)) throw new Error('Role state has changed since incident; cannot approve this snapshot');
      }
    }
    const outcome = await store.decide({
      incidentId: id,
      actorId: interaction.user.id,
      ownerId,
      actorIsManager: isManager,
      action: action === 'keep' ? 'keep' : 'restore',
      restore: row => row.context.kind?.startsWith('role_') ?
        restoreRoleDefinitionIncident(interaction.guild, row, interaction.user.id) :
        restoreMemberIncident(interaction.guild, row, interaction.user.id)
    });
    if (action === 'keep') {
      if (incident.context.kind?.startsWith('role_')) {
        const role = await interaction.guild.roles.fetch(incident.target_id).catch(() => null);
        if (role) saveRoleSnapshot(role);
        else db.prepare('DELETE FROM authority_role_snapshots WHERE guild_id=? AND role_id=?').run(interaction.guildId, incident.target_id);
      } else {
        putSnapshot(interaction.guildId, incident.target_id, incident.afterRoles);
      }
    }
    await alert(interaction.guild, outcome, {
      actorId: interaction.user.id,
      description: action === 'keep' ? 'Changes retained by reviewer. Founder may override a Manager approval.' :
        'Role restoration verified. The previous decisions remain recorded.',
      buttons: action === 'keep'
    });
    await notifyFounderOfManagerDecision(interaction, incident, outcome, action);
    await interaction.editReply('Incident #' + id + ': ' + outcome.status);
  } catch (error) {
    await interaction.editReply('OAI: ' + safe(error.message, 1200));
  }
  return true;
}


export function registerAuthorityMemberJoin(member) {
  if (member.guild.id !== config.guildId || !readyGuilds.has(member.guild.id)) return;
  putSnapshot(member.guild.id, member.id, fromMember(member));
}

export function registerAuthorityMemberDeparture(member) {
  if (member.guild.id !== config.guildId || !readyGuilds.has(member.guild.id)) return;
  const expected = getSnapshot(member.guild.id, member.id);
  if (!expected) return;
  db.prepare('INSERT INTO authority_member_departures(guild_id,member_id,roles_json,departed_at) VALUES (?,?,?,?)')
    .run(member.guild.id, member.id, JSON.stringify(expected), Date.now());
  db.prepare('DELETE FROM authority_member_snapshots WHERE guild_id=? AND member_id=?')
    .run(member.guild.id, member.id);
}

function outstandingIncident(guildId, targetId) {
  return Boolean(db.prepare(
    "SELECT 1 FROM authority_incidents WHERE guild_id=? AND target_id=? AND status IN ('pending','restore_pending','restore_failed') LIMIT 1"
  ).get(guildId, targetId));
}

export async function sweepAuthorityIntegrity(guild) {
  if (!guild || !readyGuilds.has(guild.id)) return { status: 'inactive' };
  const allRoles = await guild.roles.fetch();
  const allMembers = await guild.members.fetch();
  let drift = 0;
  for (const member of allMembers.values()) {
    if (outstandingIncident(guild.id, member.id)) continue;
    const expected = getSnapshot(guild.id, member.id);
    const actual = fromMember(member);
    if (!expected) {
      if (!actual.length) {
        putSnapshot(guild.id, member.id, []);
      } else {
        const incident = await incidentForDrift(member, [], actual, 'periodic');
        if (incident) {
          drift++;
          await alert(guild, incident, { description: 'Untracked member role state discovered during periodic reconciliation.' });
        }
      }
    } else if (!same(expected, actual) && !pendingIntent(guild.id, member.id, actual)) {
      const incident = await incidentForDrift(member, expected, actual, 'periodic');
      if (incident) {
        drift++;
        await alert(guild, incident, { description: 'Role drift found during periodic reconciliation; changes require review.' });
      }
    }
  }
  for (const role of allRoles.values()) {
    if (outstandingIncident(guild.id, role.id)) continue;
    const expected = roleSnapshot(guild.id, role.id);
    if (!expected) await evaluateRoleDefinitionCreate(role);
    else if (JSON.stringify(expected) !== JSON.stringify(roleDefinition(role))) {
      await evaluateRoleDefinitionUpdate(null, role, { source: 'periodic' });
      drift++;
    }
  }
  for (const row of db.prepare('SELECT role_id FROM authority_role_snapshots WHERE guild_id=?').all(guild.id)) {
    if (!allRoles.has(row.role_id) && !outstandingIncident(guild.id, row.role_id)) {
      await evaluateRoleDefinitionDelete({ guild, id: row.role_id });
      drift++;
    }
  }
  return { status: 'scanned', members: allMembers.size, roles: allRoles.size, drift };
}

export function startAuthorityMonitoring(client) {
  if (monitor) return;
  monitor = setInterval(async () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    await sweepAuthorityIntegrity(guild).then(result => {
      if (result.drift) console.warn('[OAI] Periodic drift detected:', JSON.stringify(result));
    }).catch(error => console.error('[OAI] Periodic sweep failed:', error.message));
  }, 5 * 60 * 1000);
  monitor.unref?.();
}

export const authorityDecisionStore = store;
export const authorityIntegrityStatus = () => ({ connectedGuilds: [...readyGuilds], alertId });
