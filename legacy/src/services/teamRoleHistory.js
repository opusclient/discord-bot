import { db } from '../db.js';

db.exec("CREATE TABLE IF NOT EXISTS team_role_history (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('promote','demote')), branch TEXT NOT NULL, from_role_id TEXT, from_role_name TEXT, to_role_id TEXT, to_role_name TEXT, added_roles TEXT NOT NULL DEFAULT '[]', removed_roles TEXT NOT NULL DEFAULT '[]', reason TEXT, interaction_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (guild_id, user_id, interaction_id))");
db.exec('CREATE INDEX IF NOT EXISTS idx_team_role_history_user ON team_role_history (guild_id, user_id, created_at DESC, id DESC)');

const write = db.prepare("INSERT OR IGNORE INTO team_role_history (guild_id,user_id,moderator_id,mode,branch,from_role_id,from_role_name,to_role_id,to_role_name,added_roles,removed_roles,reason,interaction_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const read = db.prepare("SELECT * FROM team_role_history WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?");
const count = db.prepare("SELECT COUNT(*) AS total FROM team_role_history WHERE guild_id = ? AND user_id = ?");
const normalizeRole = role => role ? { id: role.id, name: role.name } : null;

export function recordTeamRoleChange({
  guildId, userId, moderatorId, mode, branch = 'independent',
  fromRole = null, toRole = null,
  addedRoles = [], removedRoles = [],
  reason = null, interactionId, createdAt = Date.now()
}) {
  if (!['promote', 'demote'].includes(mode)) throw new Error('Invalid role transition');
  if (![guildId, userId, moderatorId, interactionId].every(id => /^\d{17,20}$/.test(String(id)))) {
    throw new Error('Invalid role history identifiers');
  }
  write.run(
    guildId, userId, moderatorId, mode, branch,
    fromRole?.id ?? null, fromRole?.name ?? null,
    toRole?.id ?? null, toRole?.name ?? null,
    JSON.stringify(addedRoles.map(normalizeRole)),
    JSON.stringify(removedRoles.map(normalizeRole)),
    reason, interactionId, createdAt
  );
  return db.prepare(
    'SELECT * FROM team_role_history WHERE guild_id = ? AND user_id = ? AND interaction_id = ?'
  ).get(guildId, userId, interactionId);
}

export function getTeamRoleHistory(guildId, userId, limit = 5) {
  const size = Math.max(1, Math.min(10, Number(limit) || 5));
  const rows = read.all(guildId, userId, size).map(row => ({
    ...row,
    addedRoles: JSON.parse(row.added_roles),
    removedRoles: JSON.parse(row.removed_roles)
  }));
  return { rows, total: Number(count.get(guildId, userId)?.total ?? 0) };
}
