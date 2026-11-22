import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';

const root = path.resolve(process.env.LOG_INTEGRITY_DIR ||
  path.join(path.dirname(path.resolve(config.dbPath)), 'log-integrity'));
const maxAttachment = 100 * 1024 * 1024;
const maxMessage = 300 * 1024 * 1024;
const pending = new Map();

mkdirSync(root, { recursive: true, mode: 0o700 });
db.exec(`
CREATE TABLE IF NOT EXISTS log_integrity_messages (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_id TEXT,
  posted_at INTEGER,
  captured_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at INTEGER,
  deleted_by TEXT,
  attribution TEXT,
  restored_id TEXT,
  restored_at INTEGER,
  PRIMARY KEY (guild_id, channel_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_log_integrity_status
  ON log_integrity_messages(guild_id, channel_id, status);
CREATE TABLE IF NOT EXISTS log_integrity_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  actor_id TEXT,
  attribution TEXT,
  outcome TEXT NOT NULL,
  details TEXT
);
CREATE TABLE IF NOT EXISTS log_integrity_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);
`);

const select = db.prepare(
  'SELECT * FROM log_integrity_messages WHERE guild_id = ? AND channel_id = ? AND message_id = ?'
);
const save = db.prepare(`
INSERT INTO log_integrity_messages
(guild_id, channel_id, message_id, author_id, posted_at, captured_at, payload_json)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(guild_id, channel_id, message_id) DO UPDATE SET
  author_id = excluded.author_id,
  posted_at = excluded.posted_at,
  captured_at = excluded.captured_at,
  payload_json = excluded.payload_json
WHERE log_integrity_messages.status = 'active'
`);
const incident = db.prepare(`
INSERT INTO log_integrity_incidents
(guild_id, channel_id, message_id, type, occurred_at, actor_id, attribution, outcome, details)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const serialized = item => item?.toJSON?.() ?? item;
const parse = value => {
  try { return JSON.parse(value); } catch { return null; }
};

function attachments(message) {
  const collection = message?.attachments;
  const values = collection?.values ? [...collection.values()] :
    Array.isArray(collection) ? collection : [];
  return values.map(item => ({
    id: String(item.id ?? ''),
    filename: String(item.name ?? item.filename ?? 'attachment').slice(0, 140),
    size: Number(item.size ?? 0),
    contentType: item.contentType ?? item.content_type ?? null,
    url: item.url ?? null,
    storedPath: null,
    sha256: null,
    error: null
  }));
}

export function snapshotPayload(message) {
  return {
    content: String(message?.content ?? ''),
    embeds: (message?.embeds ?? []).slice(0, 10).map(serialized),
    attachments: attachments(message),
    componentCount: message?.components?.length ?? 0,
    stickerCount: message?.stickers?.size ?? 0,
    authorName: String(message?.author?.username ?? message?.author?.tag ?? 'Unknown'),
    authorId: message?.author?.id ?? message?.authorId ?? null
  };
}

export function storedMessage(guildId, channelId, messageId) {
  return select.get(String(guildId), String(channelId), String(messageId)) ?? null;
}

export function storedPayload(row) {
  return row ? parse(row.payload_json) : null;
}

export function recordIncident({ guildId = config.guildId, channelId, messageId = null,
  type, occurredAt = Date.now(), actorId = null, attribution = 'unknown',
  outcome, details = null }) {
  return incident.run(guildId, channelId, messageId, type, occurredAt, actorId,
    attribution, outcome, typeof details === 'string' ? details : JSON.stringify(details ?? null));
}

export function markDeleted(row, { at, actorId, attribution, status }) {
  const changed = db.prepare(`
    UPDATE log_integrity_messages
    SET status = ?, deleted_at = ?, deleted_by = ?, attribution = ?
    WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND status = 'active'
  `).run(status, at, actorId, attribution, row.guild_id, row.channel_id, row.message_id);
  return changed.changes > 0;
}

export function markRestored(row, newId, time = Date.now()) {
  db.prepare(`
    UPDATE log_integrity_messages SET status = 'restored', restored_id = ?, restored_at = ?
    WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND status = 'recovering'
  `).run(newId, time, row.guild_id, row.channel_id, row.message_id);
}

export function markFailed(row) {
  db.prepare(`
    UPDATE log_integrity_messages SET status = 'failed'
    WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND status = 'recovering'
  `).run(row.guild_id, row.channel_id, row.message_id);
}

export function listActive(guildId, channelId) {
  return db.prepare(`
    SELECT * FROM log_integrity_messages
    WHERE guild_id = ? AND channel_id = ? AND status = 'active'
    ORDER BY posted_at ASC, message_id ASC
  `).all(guildId, channelId);
}

export function listByChannel(guildId, channelId) {
  return db.prepare(`
    SELECT * FROM log_integrity_messages WHERE guild_id = ? AND channel_id = ?
    AND status IN ('active', 'recovering', 'failed') ORDER BY posted_at ASC, message_id ASC
  `).all(guildId, channelId);
}

export function snapshotChannel(channel, guildId = config.guildId) {
  if (!channel?.id || !channel?.name) return null;
  const overwrites = channel.permissionOverwrites?.cache?.values
    ? [...channel.permissionOverwrites.cache.values()].map(row => ({
      id: row.id, type: row.type,
      allow: String(row.allow?.bitfield ?? row.allow ?? '0'),
      deny: String(row.deny?.bitfield ?? row.deny ?? '0')
    }))
    : (channel.permission_overwrites ?? []);
  const record = {
    name: channel.name,
    parentId: channel.parentId ?? channel.parent_id ?? null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw),
    overwrites
  };
  db.prepare(`
    INSERT INTO log_integrity_channels (guild_id, channel_id, snapshot_json, captured_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, channel_id)
    DO UPDATE SET snapshot_json = excluded.snapshot_json, captured_at = excluded.captured_at
  `).run(guildId, channel.id, JSON.stringify(record), Date.now());
  return record;
}

export function storedChannel(guildId, channelId) {
  const row = db.prepare(
    'SELECT snapshot_json FROM log_integrity_channels WHERE guild_id = ? AND channel_id = ?'
  ).get(guildId, channelId);
  return row ? parse(row.snapshot_json) : null;
}

async function fetchAttachment(attachment, folder, remaining, fetcher) {
  if (!attachment.id || !/^\d{16,23}$/.test(attachment.id)) {
    attachment.error = 'invalid_attachment_id';
    return 0;
  }
  if (!attachment.url) {
    attachment.error = 'missing_attachment_url';
    return 0;
  }
  let url;
  try { url = new URL(attachment.url); } catch {
    attachment.error = 'invalid_attachment_url';
    return 0;
  }
  if (url.protocol !== 'https:' ||
      !['cdn.discordapp.com', 'media.discordapp.net', 'cdn.discordapp.net'].includes(url.hostname)) {
    attachment.error = 'untrusted_attachment_origin';
    return 0;
  }
  const allowance = Math.min(maxAttachment, remaining);
  if (attachment.size > allowance) {
    attachment.error = 'attachment_exceeds_archive_limit';
    return 0;
  }
  const dest = path.join(folder, attachment.id);
  const relative = path.relative(root, dest);
  if (existsSync(dest)) {
    const data = readFileSync(dest);
    attachment.storedPath = relative;
    attachment.sha256 = createHash('sha256').update(data).digest('hex');
    attachment.error = null;
    return data.length;
  }
  try {
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error('cdn_http_' + response.status);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > allowance) throw new Error('attachment_exceeds_archive_limit');
    const reader = response.body.getReader();
    const buffers = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > allowance) {
          await reader.cancel().catch(() => {});
          throw new Error('attachment_exceeds_archive_limit');
        }
        buffers.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const data = Buffer.concat(buffers, total);
    await writeFile(dest, data, { mode: 0o600, flag: 'wx' });
    attachment.storedPath = relative;
    attachment.sha256 = createHash('sha256').update(data).digest('hex');
    attachment.error = null;
    return total;
  } catch (error) {
    attachment.error = String(error.message).slice(0, 120);
    return 0;
  }
}

async function captureAttachments(message, rowKey, { fetcher = fetch } = {}) {
  let row = storedMessage(...rowKey);
  if (!row || row.status !== 'active') return;
  const payload = storedPayload(row);
  if (!payload?.attachments?.length) return;
  const folder = path.join(root, rowKey[1], rowKey[2]);
  let remaining = maxMessage;
  for (const attachment of payload.attachments) {
    remaining -= await fetchAttachment(attachment, folder, remaining, fetcher);
  }
  row = storedMessage(...rowKey);
  if (row?.status === 'active') {
    save.run(rowKey[0], rowKey[1], rowKey[2], row.author_id, row.posted_at,
      Date.now(), JSON.stringify(payload));
  } else {
    db.prepare(`
      UPDATE log_integrity_messages SET payload_json = ? WHERE guild_id = ?
      AND channel_id = ? AND message_id = ?
    `).run(JSON.stringify(payload), ...rowKey);
  }
}

export async function archiveLogMessage(message, { fetcher = fetch } = {}) {
  const guildId = message?.guild?.id ?? message?.guildId;
  const channelId = message?.channelId ?? message?.channel?.id;
  const messageId = message?.id;
  if (!guildId || !channelId || !messageId) return null;
  const key = [String(guildId), String(channelId), String(messageId)];
  if (pending.has(key[2])) return pending.get(key[2]);
  const task = (async () => {
    const existing = storedMessage(...key);
    if (existing && existing.status !== 'active') return existing;
    const payload = snapshotPayload(message);
    const prior = storedPayload(existing);
    if (prior?.attachments?.length) {
      for (const entry of payload.attachments) {
        const old = prior.attachments.find(value => value.id === entry.id);
        if (old?.storedPath) {
          entry.storedPath = old.storedPath;
          entry.sha256 = old.sha256;
        }
      }
    }
    save.run(key[0], key[1], key[2], payload.authorId,
      message.createdTimestamp ?? (message.timestamp ? Date.parse(message.timestamp) : Date.now()),
      Date.now(), JSON.stringify(payload));
    await captureAttachments(message, key, { fetcher });
    return storedMessage(...key);
  })();
  pending.set(key[2], task);
  return task.finally(() => {
    if (pending.get(key[2]) === task) pending.delete(key[2]);
  });
}

export async function waitForLogArchive(messageId) {
  if (pending.has(messageId)) await pending.get(messageId).catch(() => {});
}

export async function filesForRecovery(row) {
  const payload = storedPayload(row);
  const files = [];
  const missing = [];
  for (const attachment of payload?.attachments ?? []) {
    if (!attachment.storedPath || !attachment.sha256) {
      missing.push(attachment.filename + ' (' + (attachment.error ?? 'not archived') + ')');
      continue;
    }
    const dest = path.resolve(root, attachment.storedPath);
    if (!dest.startsWith(root + path.sep)) {
      missing.push(attachment.filename + ' (invalid stored path)');
      continue;
    }
    const data = await readFile(dest).catch(() => null);
    if (!data || createHash('sha256').update(data).digest('hex') !== attachment.sha256) {
      missing.push(attachment.filename + ' (archive integrity check failed)');
      continue;
    }
    files.push({ attachment: dest, name: attachment.filename });
  }
  return { files, missing };
}

export function ownerDeletedLogChannel(guildId, channelId) {
  return Boolean(db.prepare(
    "SELECT 1 FROM log_integrity_incidents WHERE guild_id = ? AND channel_id = ? AND type = 'channel_delete' AND outcome = 'owner_exempt' ORDER BY id DESC LIMIT 1"
  ).get(guildId, channelId));
}

export function countArchived(guildId = config.guildId) {
  return db.prepare(`
    SELECT channel_id, status, COUNT(*) AS count
    FROM log_integrity_messages WHERE guild_id = ?
    GROUP BY channel_id, status
  `).all(guildId);
}

export function countIncidents(guildId = config.guildId) {
  return db.prepare(`
    SELECT type, outcome, COUNT(*) AS count FROM log_integrity_incidents
    WHERE guild_id = ? GROUP BY type, outcome
  `).all(guildId);
}
