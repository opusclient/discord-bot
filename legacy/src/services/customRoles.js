import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS custom_roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  color INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_roles_guild ON custom_roles(guild_id, created_at DESC);
`);

export function parseRoleColor(input) {
  const color = String(input ?? '').trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(color)) {
    return { error: 'Color must be a six-digit hex value, for example `#7C3AED`.' };
  }
  const value = Number.parseInt(color.replace(/^#/, ''), 16);
  if (value === 0) {
    return { error: '`#000000` is treated as the default role color by Discord. Choose another hex color.' };
  }
  return { value, hex: '#' + value.toString(16).toUpperCase().padStart(6, '0') };
}

export function validateCustomRoleName(input) {
  const name = String(input ?? '').trim();
  if (!name || name.length > 100) {
    return { error: 'Role name must contain between 1 and 100 characters.' };
  }
  if (/[\r\n]/.test(name) || /@everyone|@here|<@/i.test(name)) {
    return { error: 'Role name cannot contain mentions or line breaks.' };
  }
  return { value: name };
}

export function getCustomRole(guildId, roleId) {
  return db.prepare('SELECT * FROM custom_roles WHERE guild_id = ? AND role_id = ?').get(guildId, roleId) ?? null;
}

export function listCustomRoles(guildId, { page = 1, pageSize = 10 } = {}) {
  const limit = Math.max(1, Math.min(20, Math.floor(pageSize)));
  const count = Number(db.prepare('SELECT COUNT(*) AS total FROM custom_roles WHERE guild_id = ?').get(guildId).total);
  const pages = Math.max(1, Math.ceil(count / limit));
  const currentPage = Math.max(1, Math.min(pages, Math.floor(page)));
  const roles = db.prepare('SELECT * FROM custom_roles WHERE guild_id = ? ORDER BY created_at DESC, role_id DESC LIMIT ? OFFSET ?')
    .all(guildId, limit, (currentPage - 1) * limit);
  return { roles, total: count, page: currentPage, pages };
}

export function customRoleNameExists(guildId, name) {
  const rows = db.prepare('SELECT role_name FROM custom_roles WHERE guild_id = ?').all(guildId);
  return rows.some(row => row.role_name.toLocaleLowerCase() === name.toLocaleLowerCase());
}

export function recordCustomRole({ guildId, roleId, name, color, createdBy }) {
  db.prepare('INSERT INTO custom_roles (guild_id, role_id, role_name, color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId, roleId, name, color, createdBy, Date.now());
}

export function untrackCustomRole(guildId, roleId) {
  return Number(db.prepare('DELETE FROM custom_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId).changes);
}
