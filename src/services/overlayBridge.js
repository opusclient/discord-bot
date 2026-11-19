import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIR_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 8192;
const rate = new Map();
const memberCache = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
const requestIp = request => {
  const remote = request.socket.remoteAddress || 'unknown';
  if (process.env.OPUS_OVERLAY_TRUST_PROXY === '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
    const forwarded = request.headers['x-real-ip'];
    if (typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  }
  return remote;
};
const secret = () => randomBytes(32).toString('base64url');
const makeCode = () => Array.from(randomBytes(10), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const send = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const statement = {
  pairInsert: db.prepare('INSERT INTO overlay_pairings (id, code_hash, poll_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
  pairFind: db.prepare('SELECT * FROM overlay_pairings WHERE id = ? AND poll_hash = ?'),
  pairConfirm: db.prepare('UPDATE overlay_pairings SET user_id = ?, confirmed_at = ? WHERE code_hash = ? AND user_id IS NULL AND delivered_at IS NULL AND expires_at > ?'),
  pairDeliver: db.prepare('UPDATE overlay_pairings SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL'),
  sessionInsert: db.prepare('INSERT INTO overlay_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionFind: db.prepare('SELECT * FROM overlay_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?'),
  sessionRevoke: db.prepare('UPDATE overlay_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'),
  sessionCount: db.prepare('SELECT COUNT(*) AS count FROM overlay_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?'),
  eventInsert: db.prepare('INSERT OR IGNORE INTO overlay_events (event_id, user_id, event_type, room_id, payload, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  eventFind: db.prepare('SELECT event_id, delivered_at FROM overlay_events WHERE event_id = ?'),
  pending: db.prepare('SELECT event_id, user_id, event_type, payload, occurred_at FROM overlay_events WHERE delivered_at IS NULL ORDER BY received_at LIMIT 25'),
  eventDelivered: db.prepare('UPDATE overlay_events SET delivered_at = ? WHERE event_id = ?')
};

export function confirmOverlayPairing(userId, code) {
  const normalized = String(code || '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(normalized)) return false;
  const now = Date.now();
  const result = statement.pairConfirm.run(userId, now, hash(normalized), now);
  if (!result.changes) return false;
  statement.sessionRevoke.run(now, userId);
  memberCache.delete(userId);
  return true;
}

export function revokeOverlayAccess(userId) {
  memberCache.delete(userId);
  db.prepare('UPDATE overlay_pairings SET expires_at = ? WHERE user_id = ? AND delivered_at IS NULL').run(Date.now(), userId);
  return Number(statement.sessionRevoke.run(Date.now(), userId).changes);
}

export function getOverlayStatus(userId) {
  const row = statement.sessionCount.get(userId, Date.now());
  return { activeSessions: Number(row.count) };
}

export function invalidateOverlayMember(userId) {
  memberCache.delete(userId);
}

async function allowedMember(client, userId) {
  const now = Date.now();
  const cached = memberCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.allowed;
  let allowed = false;
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch({ user: userId, force: true });
    allowed = Boolean(member && !member.user.bot && member.roles.cache.has(config.verifiedRoleId));
  } catch (error) {
    if (error.code !== 10007 && error.code !== 10004) return false;
  }
  memberCache.set(userId, { allowed, expiresAt: now + 15000 });
  if (!allowed) revokeOverlayAccess(userId);
  return allowed;
}

async function authorize(client, request) {
  const auth = request.headers.authorization || '';
  if (!/^Bearer [A-Za-z0-9_-]{40,120}$/.test(auth)) return null;
  const session = statement.sessionFind.get(hash(auth.slice(7)), Date.now());
  if (!session) return null;
  if (!(await allowedMember(client, session.user_id))) return null;
  return session;
}

function throttle(key, max, period) {
  const now = Date.now();
  const existing = rate.get(key) || [];
  const valid = existing.filter(ts => now - ts < period);
  if (valid.length >= max) return false;
  valid.push(now);
  rate.set(key, valid);
  if (rate.size > 4000) for (const [k, v] of rate) if (v[v.length - 1] < now - 600000) rate.delete(k);
  return true;
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Payload too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Invalid JSON'); error.status = 400; throw error; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Invalid object');
    error.status = 400;
    throw error;
  }
  return value;
}

const username = value => typeof value === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(value);
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9 _.-]+$/.test(value);
const ratio = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1000000) || (typeof value === 'string' && /^(?:-|∞|[0-9]{1,6}(?:\.[0-9]{1,3})?)$/.test(value));

export function parseOverlayEvent(value) {
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(value.eventId || '')) return null;
  if (!['match.join', 'match.leave', 'player.identified'].includes(value.type)) return null;
  if (!Number.isInteger(value.occurredAt) || Math.abs(Date.now() - value.occurredAt) > 300000) return null;
  if (!bounded(value.roomId, 80) || !/^[A-Za-z0-9_-]+$/.test(value.roomId)) return null;
  if (!bounded(value.gameMode, 32)) return null;
  if (value.type !== 'player.identified') return {
    eventId: value.eventId, type: value.type, occurredAt: value.occurredAt,
    roomId: value.roomId, gameMode: value.gameMode
  };
  const player = value.player;
  if (!player || !username(player.nickname) || !username(player.realName)) return null;
  if (player.rank !== undefined && !bounded(player.rank, 32)) return null;
  if (player.guild !== undefined && !bounded(player.guild, 32)) return null;
  if (player.level !== undefined && (!Number.isInteger(player.level) || player.level < 0 || player.level > 100000)) return null;
  if (player.joinedAt !== undefined && (!Number.isInteger(player.joinedAt) || player.joinedAt > value.occurredAt + 5000 || value.occurredAt - player.joinedAt > 3600000)) return null;
  const stats = player.stats || {};
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  if (['kdr', 'fkdr', 'wlr'].some(k => stats[k] !== undefined && !ratio(stats[k]))) return null;
  return {
    eventId: value.eventId, type: value.type, occurredAt: value.occurredAt,
    roomId: value.roomId, gameMode: value.gameMode,
    player: {
      nickname: player.nickname, realName: player.realName,
      rank: player.rank || '-', level: player.level ?? null, guild: player.guild || '-',
      joinedAt: player.joinedAt || null,
      stats: { kdr: String(stats.kdr ?? '-'), fkdr: String(stats.fkdr ?? '-'), wlr: String(stats.wlr ?? '-') }
    }
  };
}

export function buildOverlayEmbed(event, userId) {
  const embed = new EmbedBuilder()
    .setColor(event.type === 'player.identified' ? 0x5865f2 : 0x64748b)
    .setTitle(event.type === 'player.identified' ? 'BedWars · Player Identified' : event.type === 'match.join' ? 'BedWars · Match Joined' : 'BedWars · Match Left')
    .addFields(
      { name: 'Room', value: event.roomId, inline: true },
      { name: 'Game Mode', value: event.gameMode, inline: true },
      { name: 'Reported By', value: '<@' + userId + '>', inline: true },
      { name: 'Event Time', value: '<t:' + Math.floor(event.occurredAt / 1000) + ':F>' }
    )
    .setTimestamp(event.occurredAt)
    .setFooter({ text: 'Opus Overlay · ' + event.eventId.slice(0, 48) });
  if (event.player) {
    const p = event.player;
    embed.addFields(
      { name: 'Nickname', value: p.nickname, inline: true },
      { name: 'Real Username', value: p.realName, inline: true },
      { name: 'Rank / Level / Guild', value: p.rank + ' / ' + (p.level ?? '-') + ' / ' + p.guild },
      { name: 'KDR / FKDR / WLR', value: p.stats.kdr + ' / ' + p.stats.fkdr + ' / ' + p.stats.wlr },
      { name: 'First Seen', value: p.joinedAt ? '<t:' + Math.floor(p.joinedAt / 1000) + ':T>' : 'Not reported' }
    );
  }
  return embed;
}

async function deliverPending(client) {
  if (!config.overlay?.eventChannelId) return;
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.overlay.eventChannelId);
  if (!channel || !channel.isTextBased() || channel.guildId !== config.guildId) return;
  const everyone = channel.permissionsFor?.(guild.roles.everyone);
  const verified = channel.permissionsFor?.(config.verifiedRoleId);
  if (everyone?.has(PermissionFlagsBits.ViewChannel) || verified?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error('Overlay event channel must be restricted from @everyone and Verified members');
  }
  for (const row of statement.pending.all()) {
    const event = JSON.parse(row.payload);
    await channel.send({ embeds: [buildOverlayEmbed(event, row.user_id)], allowedMentions: { parse: [] } });
    statement.eventDelivered.run(Date.now(), row.event_id);
  }
}

let deliveryBusy = false;
async function flush(client) {
  if (deliveryBusy) return;
  deliveryBusy = true;
  try { await deliverPending(client); }
  catch (error) { console.error('[overlay] Delivery failed:', error.message); }
  finally { deliveryBusy = false; }
}

export function startOverlayBridge(client, options = {}) {
  if (config.overlay?.enabled === false) return null;
  const port = options.port ?? Number(process.env.OPUS_OVERLAY_PORT || 8790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid OPUS_OVERLAY_PORT');
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'POST' && request.url === '/v1/overlay/pair') {
        if (!throttle('pair:' + requestIp(request), 10, 600000)) return send(response, 429, { error: 'Rate limit reached' });
        const now = Date.now();
        const code = makeCode();
        const pairingId = secret();
        const pollToken = secret();
        statement.pairInsert.run(pairingId, hash(code), hash(pollToken), now, now + PAIR_TTL);
        return send(response, 201, { pairingId, code, pollToken, expiresAt: now + PAIR_TTL });
      }
      if (request.method === 'POST' && request.url === '/v1/overlay/pair/status') {
        const body = await jsonBody(request);
        const auth = request.headers.authorization || '';
        if (!/^Bearer [A-Za-z0-9_-]{40,120}$/.test(auth) || typeof body.pairingId !== 'string') return send(response, 401, { error: 'Unauthorized' });
        const pair = statement.pairFind.get(body.pairingId, hash(auth.slice(7)));
        if (!pair || pair.expires_at <= Date.now()) return send(response, 401, { error: 'Pairing expired or invalid' });
        if (!pair.user_id) return send(response, 202, { status: 'pending' });
        if (pair.delivered_at) return send(response, 409, { error: 'Pairing already completed' });
        if (!(await allowedMember(client, pair.user_id))) return send(response, 403, { error: 'Discord verification required' });
        const token = secret();
        const now = Date.now();
        db.exec('BEGIN IMMEDIATE');
        try {
          const delivered = statement.pairDeliver.run(now, pair.id);
          if (!delivered.changes) { db.exec('ROLLBACK'); return send(response, 409, { error: 'Pairing already completed' }); }
          statement.sessionInsert.run(hash(token), pair.user_id, now, now + SESSION_TTL);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(response, 200, { status: 'linked', accessToken: token, expiresAt: now + SESSION_TTL });
      }
      if (request.method === 'GET' && request.url === '/v1/overlay/session') {
        const session = await authorize(client, request);
        if (!session) return send(response, 401, { linked: false });
        return send(response, 200, { linked: true, discordUserId: session.user_id, expiresAt: session.expires_at });
      }
      if (request.method === 'POST' && request.url === '/v1/overlay/session/refresh') {
        const session = await authorize(client, request);
        if (!session) return send(response, 401, { error: 'Authentication required' });
        const token = secret();
        const now = Date.now();
        db.exec('BEGIN IMMEDIATE');
        try {
          const updated = db.prepare('UPDATE overlay_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now, session.token_hash);
          if (!updated.changes) { db.exec('ROLLBACK'); return send(response, 409, { error: 'Session was already rotated' }); }
          statement.sessionInsert.run(hash(token), session.user_id, now, now + SESSION_TTL);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(response, 200, { linked: true, accessToken: token, expiresAt: now + SESSION_TTL });
      }
      if (request.method === 'POST' && request.url === '/v1/overlay/events') {
        const session = await authorize(client, request);
        if (!session) return send(response, 401, { error: 'Authentication required' });
        if (!config.overlay?.eventChannelId) return send(response, 503, { error: 'Overlay event channel not configured' });
        if (!throttle('event:' + session.token_hash, 120, 60000)) return send(response, 429, { error: 'Event rate limit reached' });
        const event = parseOverlayEvent(await jsonBody(request));
        if (!event) return send(response, 400, { error: 'Invalid overlay event' });
        const result = statement.eventInsert.run(event.eventId, session.user_id, event.type, event.roomId, JSON.stringify(event), event.occurredAt, Date.now());
        if (!result.changes) {
          const existing = statement.eventFind.get(event.eventId);
          return send(response, 200, { status: existing.delivered_at ? 'delivered' : 'queued', duplicate: true });
        }
        void flush(client);
        return send(response, 202, { status: 'queued' });
      }
      return send(response, 404, { error: 'Not found' });
    } catch (error) {
      console.error('[overlay] Request failed:', error.message);
      return send(response, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
  const timer = setInterval(() => {
    const now = Date.now();
    db.prepare('DELETE FROM overlay_pairings WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM overlay_events WHERE received_at < ? AND delivered_at IS NOT NULL').run(now - 30 * 86400000);
    db.prepare('DELETE FROM overlay_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').run(now, now - 30 * 86400000);
    void flush(client);
  }, 30000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  server.listen(port, '127.0.0.1', () => {
    console.log('[overlay] Backend listening on 127.0.0.1:' + server.address().port);
  });
  return server;
}
