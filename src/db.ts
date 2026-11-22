// SQLite access layer. Uses the built-in node:sqlite module (no native dependencies).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';


export type CaseRecord = {
  id: number;
  guild_id: string;
  case_number: number;
  user_id: string;
  moderator_id: string;
  type: string;
  reason: string | null;
  duration_ms: number | null;
  expires_at: number | null;
  status: string;
  hidden: number;
  created_at: number;
  updated_at: number | null;
};

export type TicketRecord = {
  id: number;
  guild_id: string;
  channel_id: string;
  owner_id: string;
  type: string;
  status: string;
  purpose: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  closed_by: string | null;
  closed_note: string | null;
  created_at: number;
  closed_at: number | null;
  ticket_number: number;
};

export type VoiceRecord = {
  id: number;
  guild_id: string;
  channel_id: string;
  owner_id: string;
  number: number;
  panel_message_id: string | null;
  created_at: number;
};

export type InstallMessageRecord = {
  guild_id: string;
  key: string;
  channel_id: string;
  message_id: string;
};

export type CreateCaseInput = {
  guildId: string;
  userId: string;
  moderatorId: string;
  type: string;
  reason?: string | null;
  durationMs?: number | null;
  createdAt?: number;
};

export type CreateTicketInput = {
  guildId: string;
  channelId: string;
  ownerId: string;
  type?: string;
  purpose?: string | null;
  ticketNumber?: number | null;
  createdAt?: number;
};

export type CreateVoiceInput = {
  guildId: string;
  channelId: string;
  ownerId: string;
  number?: number;
  createdAt?: number;
};

export type TicketClaimResult = { error?: string; claimed?: boolean };

const dbFile = path.resolve(config.dbPath);
mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS account_link_events (
  event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked INTEGER NOT NULL,
  event_timestamp INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_link_state (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked INTEGER NOT NULL,
  event_timestamp INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`);


db.exec('CREATE TABLE IF NOT EXISTS overlay_pairings (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, poll_hash TEXT NOT NULL, user_id TEXT, created_at INTEGER NOT NULL, confirmed_at INTEGER, expires_at INTEGER NOT NULL, delivered_at INTEGER)');
db.exec('CREATE INDEX IF NOT EXISTS idx_overlay_pairings_code ON overlay_pairings (code_hash, expires_at)');
db.exec('CREATE TABLE IF NOT EXISTS overlay_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)');
db.exec('CREATE INDEX IF NOT EXISTS idx_overlay_sessions_user ON overlay_sessions (user_id, revoked_at, expires_at)');
db.exec('CREATE TABLE IF NOT EXISTS overlay_events (event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_type TEXT NOT NULL, room_id TEXT NOT NULL, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, delivered_at INTEGER)');
db.exec('CREATE INDEX IF NOT EXISTS idx_overlay_events_pending ON overlay_events (delivered_at, received_at)');

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  case_number   INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  moderator_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  reason        TEXT,
  duration_ms   INTEGER,
  expires_at    INTEGER,
  status        TEXT NOT NULL DEFAULT 'active',
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER,
  UNIQUE (guild_id, case_number)
);

CREATE INDEX IF NOT EXISTS idx_cases_user   ON cases (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (guild_id, status, type);
CREATE INDEX IF NOT EXISTS idx_cases_temp   ON cases (status, expires_at);

CREATE TABLE IF NOT EXISTS trap_stats (
  guild_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, key)
);

CREATE TABLE IF NOT EXISTS install_messages (
  guild_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'general',
  status      TEXT NOT NULL DEFAULT 'open',
  closed_by   TEXT,
  closed_note TEXT,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild  ON tickets (guild_id, status, owner_id);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);

CREATE TABLE IF NOT EXISTS voice_channels (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  channel_id       TEXT NOT NULL,
  owner_id         TEXT NOT NULL,
  number           INTEGER NOT NULL DEFAULT 0,
  panel_message_id TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_guild   ON voice_channels (guild_id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_channel ON voice_channels (channel_id);
`);

// Legacy databases: add the number column when the table already exists without it
// (the statement fails silently when the fresh schema above created it).
try {
  db.exec('ALTER TABLE voice_channels ADD COLUMN number INTEGER NOT NULL DEFAULT 0');
} catch {
  // Column already exists.
}

// Legacy databases: add the ticket type column (existing rows count as general tickets).
try {
  db.exec("ALTER TABLE tickets ADD COLUMN type TEXT NOT NULL DEFAULT 'general'");
} catch {
  // Column already exists.
}

// Migration from the initial schema (active flag -> status).
const columns = db.prepare('PRAGMA table_info(cases)').all().map((c) => c.name);
if (!columns.includes('status')) {
  db.exec("ALTER TABLE cases ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  db.exec("UPDATE cases SET status = CASE WHEN active = 1 THEN 'active' ELSE 'removed' END");
}
// The old per-guild config table is superseded by config.json.
db.exec('DROP TABLE IF EXISTS guild_config');

// Older installs tracked only the trap message; migrate it into install_messages.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
if (tables.includes('trap_message')) {
  db.exec(
    `INSERT OR REPLACE INTO install_messages (guild_id, key, channel_id, message_id)
     SELECT guild_id, 'trap', channel_id, message_id FROM trap_message`,
  );
  db.exec('DROP TABLE trap_message');
}

// ---------- Cases ----------

export function createCase({
  guildId,
  userId,
  moderatorId,
  type,
  reason = null,
  durationMs = null,
  createdAt = Date.now(),
}: CreateCaseInput): CaseRecord {
  db.exec('BEGIN IMMEDIATE');
  try {
    const counter = db
      .prepare('SELECT COALESCE(MAX(case_number), 0) + 1 AS n FROM cases WHERE guild_id = ?')
      .get(guildId);
    if (!counter) throw new Error('Failed to allocate moderation case number');
    const n = Number(counter.n);

    const expiresAt = durationMs ? createdAt + durationMs : null;
    const info = db
      .prepare(
        `INSERT INTO cases
          (guild_id, case_number, user_id, moderator_id, type, reason, duration_ms, expires_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(guildId, n, userId, moderatorId, type, reason, durationMs, expiresAt, createdAt, createdAt);

    db.exec('COMMIT');
    const created = getCaseById(Number(info.lastInsertRowid));
    if (!created) throw new Error('Created moderation case cannot be retrieved');
    return created;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const getCaseById = (id: number): CaseRecord | null =>
  (db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as unknown as CaseRecord | undefined) ?? null;

export const getCaseByNumber = (guildId: string, caseNumber: number): CaseRecord | null =>
  (db.prepare('SELECT * FROM cases WHERE guild_id = ? AND case_number = ?').get(guildId, caseNumber) as unknown as CaseRecord | undefined) ?? null;

export function listCases({ guildId, userId = null, type = null, limit = 5, offset = 0 }: { guildId: string; userId?: string | null; type?: string | null; limit?: number; offset?: number }): { rows: CaseRecord[]; total: number } {
  const where = ['guild_id = ?', 'hidden = 0'];
  const params: string[] = [guildId];
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  if (type && type !== 'all') {
    where.push('type = ?');
    params.push(type);
  }
  const whereSql = where.join(' AND ');
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM cases WHERE ${whereSql}`).get(...params)?.n ?? 0);
  const rows = db
    .prepare(`SELECT * FROM cases WHERE ${whereSql} ORDER BY case_number DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as CaseRecord[];
  return { rows, total };
}

export const countActiveByType = (guildId: string, userId: string, type: string): number =>
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? AND type = ? AND status = 'active' AND hidden = 0",
    )
    .get(guildId, userId, type)?.n as number ?? 0;

export function getActiveCases(guildId: string, userId: string, type: string | null = null): CaseRecord[] {
  const base =
    "SELECT * FROM cases WHERE guild_id = ? AND user_id = ? AND status = 'active' AND hidden = 0";
  return type
    ? db.prepare(`${base} AND type = ? ORDER BY id DESC`).all(guildId, userId, type) as unknown as CaseRecord[]
    : db.prepare(`${base} ORDER BY id DESC`).all(guildId, userId) as unknown as CaseRecord[];
}

export const getActiveTempCases = (): CaseRecord[] =>
  db
    .prepare(
      "SELECT * FROM cases WHERE status = 'active' AND hidden = 0 AND expires_at IS NOT NULL AND type IN ('mute', 'ban')",
    )
    .all() as unknown as CaseRecord[];

// Mark a single case as expired (timer elapsed) or removed (manually undone / cleared).
export const setCaseStatus = (id: number, status: string): number =>
  Number(
    db.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
      .changes,
  );

export const setActiveCasesStatus = (guildId: string, userId: string, type: string, status: string): number =>
  Number(
    db
      .prepare(
        "UPDATE cases SET status = ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND type = ? AND status = 'active'",
      )
      .run(status, Date.now(), guildId, userId, type).changes,
  );

export const hideCase = (id: number): number =>
  Number(db.prepare('UPDATE cases SET hidden = 1, updated_at = ? WHERE id = ?').run(Date.now(), id).changes);

// ---------- Do-not-type trap ----------

export function bumpTrapStat(guildId: string, key: string): void {
  db.prepare(
    `INSERT INTO trap_stats (guild_id, key, count) VALUES (?, ?, 1)
     ON CONFLICT (guild_id, key) DO UPDATE SET count = count + 1`,
  ).run(guildId, key);
}

export const getTrapStats = (guildId: string): Record<string, number> => {
  const rows = db.prepare('SELECT key, count FROM trap_stats WHERE guild_id = ?').all(guildId);
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.count)]));
};

// ---------- Install messages (setup embeds the bot keeps in channels) ----------

export const getInstallMessage = (guildId: string, key: string): InstallMessageRecord | null =>
  (db.prepare('SELECT * FROM install_messages WHERE guild_id = ? AND key = ?').get(guildId, key) as unknown as InstallMessageRecord | undefined) ?? null;

export const listInstallMessages = (guildId: string): InstallMessageRecord[] =>
  db.prepare('SELECT * FROM install_messages WHERE guild_id = ?').all(guildId) as unknown as InstallMessageRecord[];

export function setInstallMessage(guildId: string, key: string, channelId: string, messageId: string): void {
  db.prepare(
    `INSERT INTO install_messages (guild_id, key, channel_id, message_id) VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, key) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
  ).run(guildId, key, channelId, messageId);
}

export const deleteInstallMessage = (guildId: string, key: string): number =>
  Number(db.prepare('DELETE FROM install_messages WHERE guild_id = ? AND key = ?').run(guildId, key).changes);

// ---------- Tickets ----------

for (const column of ['purpose TEXT', 'claimed_by TEXT', 'claimed_at INTEGER']) {
  try {
    db.exec('ALTER TABLE tickets ADD COLUMN ' + column);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error;
  }
}

export function getTicketStats(guildId: string): { open: number; claimed: number; closed: number } {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'open' AND claimed_by IS NULL THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status = 'open' AND claimed_by IS NOT NULL THEN 1 ELSE 0 END) AS claimed_count,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count
    FROM tickets WHERE guild_id = ?
  `).get(guildId);
  return {
    open: Number(row?.open_count ?? 0),
    claimed: Number(row?.claimed_count ?? 0),
    closed: Number(row?.closed_count ?? 0),
  };
}

export function claimTicketRow(id: number, userId: string, action: 'toggle' | 'claim' | 'unclaim' = 'toggle'): TicketClaimResult {
  const row = db.prepare("SELECT * FROM tickets WHERE id = ? AND status = 'open'").get(id);
  if (!row) return { error: 'This ticket is no longer open.' };
  if (!['toggle', 'claim', 'unclaim'].includes(action)) {
    return { error: 'Invalid ticket claim action.' };
  }
  if (action === 'unclaim' && !row.claimed_by) {
    return { error: 'This ticket is not currently claimed.' };
  }
  if (row.claimed_by && row.claimed_by !== userId) {
    return { error: 'This ticket is already claimed by another staff member.' };
  }
  if (action === 'claim' && row.claimed_by === userId) {
    return { error: 'You already claimed this ticket.' };
  }
  if (row.claimed_by === userId) {
    const changed = db.prepare("UPDATE tickets SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = 'open' AND claimed_by = ?").run(id, userId);
    return changed.changes ? { claimed: false } : { error: 'Ticket status changed. Please try again.' };
  }
  const changed = db.prepare("UPDATE tickets SET claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open' AND claimed_by IS NULL").run(userId, Date.now(), id);
  return changed.changes ? { claimed: true } : { error: 'Ticket was just claimed. Please try again.' };
}

try {
  db.exec('ALTER TABLE tickets ADD COLUMN ticket_number INTEGER');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error;
}

db.exec('UPDATE tickets SET ticket_number = id WHERE ticket_number IS NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_number_guild ON tickets (guild_id, ticket_number)');
db.exec('CREATE TABLE IF NOT EXISTS ticket_number_sequences (guild_id TEXT PRIMARY KEY, next_number INTEGER NOT NULL)');

export function reserveTicketNumber(guildId: string): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    const storedMax = Number(db.prepare('SELECT COALESCE(MAX(ticket_number), 0) AS value FROM tickets WHERE guild_id = ?').get(guildId)?.value ?? 0);
    const globalMax = Number(db.prepare("SELECT COALESCE(seq, 0) AS value FROM sqlite_sequence WHERE name = 'tickets'").get()?.value ?? 0);
    const initial = Math.max(storedMax, globalMax) + 1;
    db.prepare('INSERT OR IGNORE INTO ticket_number_sequences (guild_id, next_number) VALUES (?, ?)').run(guildId, initial);
    const row = db.prepare('SELECT next_number FROM ticket_number_sequences WHERE guild_id = ?').get(guildId);
    if (!row) throw new Error('Ticket sequence row missing');
    const number = Number(row.next_number);
    db.prepare('UPDATE ticket_number_sequences SET next_number = ? WHERE guild_id = ?').run(number + 1, guildId);
    db.exec('COMMIT');
    return number;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createTicketRow({ guildId, channelId, ownerId, type = 'general', purpose = null, ticketNumber = null, createdAt = Date.now() }: CreateTicketInput): TicketRecord {
  const number = ticketNumber ?? reserveTicketNumber(guildId);
  const info = db
    .prepare(
      "INSERT INTO tickets (guild_id, channel_id, owner_id, type, status, purpose, ticket_number, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    )
    .run(guildId, channelId, ownerId, type, purpose, number, createdAt);
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(info.lastInsertRowid));
  if (!row) throw new Error('Created ticket cannot be retrieved');
  return row as unknown as TicketRecord;
}

export const getOpenTicketByOwner = (guildId: string, userId: string, type: string | null = null): TicketRecord | null =>
  db
    .prepare(
      `SELECT * FROM tickets
       WHERE guild_id = ? AND owner_id = ? AND status = 'open'${type ? ' AND type = ?' : ''}
       ORDER BY id DESC`,
    )
    .all(...(type ? [guildId, userId, type] : [guildId, userId]))[0] as unknown as TicketRecord | undefined ?? null;

export const listOpenTicketsForOwner = (guildId: string, userId: string, limit: number = 10): TicketRecord[] =>
  db.prepare(
    "SELECT * FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open' ORDER BY id DESC LIMIT ?"
  ).all(guildId, userId, Math.max(1, Math.min(20, Number(limit) || 10))) as unknown as TicketRecord[];

export const getTicketByChannel = (guildId: string, channelId: string): TicketRecord | null =>
  (db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId) as unknown as TicketRecord | undefined) ?? null;

export function closeTicketRow(id: number, { closedBy, note = null }: { closedBy: string; note?: string | null }): TicketRecord | null {
  db.prepare(
    "UPDATE tickets SET status = 'closed', closed_by = ?, closed_note = ?, closed_at = ? WHERE id = ?",
  ).run(closedBy, note, Date.now(), id);
  return (db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as unknown as TicketRecord | undefined) ?? null;
}

// Channel ids of every tracked ticket (checked when lifting the verification gate,
// since ticket channels manage their own @everyone lock).
export const listTicketChannelIds = (guildId: string): string[] =>
  db.prepare('SELECT channel_id FROM tickets WHERE guild_id = ?').all(guildId).map((r) => String(r.channel_id));

// ---------- Dynamic voice channels (create-voice) ----------

export function createVoiceRow({ guildId, channelId, ownerId, number = 0, createdAt = Date.now() }: CreateVoiceInput): VoiceRecord {
  db.prepare(
    'INSERT INTO voice_channels (guild_id, channel_id, owner_id, number, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(guildId, channelId, ownerId, number, createdAt);
  const row = db.prepare('SELECT * FROM voice_channels WHERE channel_id = ?').get(channelId);
  if (!row) throw new Error('Created voice row cannot be retrieved');
  return row as unknown as VoiceRecord;
}

export const getNextVoiceNumber = (guildId: string): number =>
  Number(
    db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM voice_channels WHERE guild_id = ?').get(guildId)?.next,
  );

export const getVoiceRowByChannel = (guildId: string, channelId: string): VoiceRecord | null =>
  (db.prepare('SELECT * FROM voice_channels WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId) as unknown as VoiceRecord | undefined) ?? null;

export const getVoiceRowByOwner = (guildId: string, userId: string): VoiceRecord | null =>
  (db.prepare('SELECT * FROM voice_channels WHERE guild_id = ? AND owner_id = ? ORDER BY id DESC').get(guildId, userId) as unknown as VoiceRecord | undefined) ?? null;

export const setVoicePanelMessage = (id: number, messageId: string) =>
  db.prepare('UPDATE voice_channels SET panel_message_id = ? WHERE id = ?').run(messageId, id);

export const deleteVoiceRow = (guildId: string, channelId: string): number =>
  Number(
    db.prepare('DELETE FROM voice_channels WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId).changes,
  );

export const setVoiceOwner = (guildId: string, channelId: string, ownerId: string) =>
  db
    .prepare('UPDATE voice_channels SET owner_id = ? WHERE guild_id = ? AND channel_id = ?')
    .run(ownerId, guildId, channelId);

// Channel ids of every spawned voice room (checked when lifting the verification
// gate, since private rooms manage their own @everyone lock).
export const listVoiceChannelIds = (guildId: string): string[] =>
  db.prepare('SELECT channel_id FROM voice_channels WHERE guild_id = ?').all(guildId).map((r) => String(r.channel_id));
