import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { syncAccountLinkStatus } from './accountRoles.js';

const inFlight = new Set();
const getRecorded = db.prepare('SELECT event_id FROM account_link_events WHERE event_id = ?');
const getLatest = db.prepare('SELECT event_timestamp FROM account_link_state WHERE guild_id = ? AND user_id = ?');
const recordEvent = db.prepare('INSERT INTO account_link_events (event_id, guild_id, user_id, linked, event_timestamp, received_at) VALUES (?, ?, ?, ?, ?, ?)');
const updateState = db.prepare('INSERT INTO account_link_state (guild_id, user_id, linked, event_timestamp, event_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET linked = excluded.linked, event_timestamp = excluded.event_timestamp, event_id = excluded.event_id');
const ageLimitMs = 5 * 60 * 1000;

const send = (response, code, body) => {
  response.writeHead(code, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ message: body }));
};

const verifySignature = (raw, signature, secret) => {
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export function startAccountLinkWebhook(client) {
  const secret = process.env.OPUS_LINK_WEBHOOK_SECRET;
  if (!secret) return null;
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('OPUS_LINK_WEBHOOK_SECRET must be at least 32 bytes');
  }
  const port = Number(process.env.OPUS_LINK_WEBHOOK_PORT || '8789');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Invalid OPUS_LINK_WEBHOOK_PORT');
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/internal/account-link') {
      send(response, 404, 'Not found');
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 8192) {
          send(response, 413, 'Payload too large');
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, request.headers['x-opus-signature'], secret)) {
        send(response, 401, 'Unauthorized');
        return;
      }
      const payload = JSON.parse(raw.toString('utf8'));
      if (
        typeof payload !== 'object' || !payload ||
        !/^[0-9]{17,20}$/.test(payload.userId) ||
        !/^[A-Za-z0-9_-]{12,128}$/.test(payload.eventId) ||
        typeof payload.linked !== 'boolean' ||
        !Number.isInteger(payload.timestamp) ||
        Math.abs(Date.now() - payload.timestamp) > ageLimitMs ||
        (payload.guildId && payload.guildId !== config.guildId)
      ) {
        send(response, 400, 'Invalid account link event');
        return;
      }
      if (getRecorded.get(payload.eventId)) {
        send(response, 409, 'Duplicate event');
        return;
      }
      const latest = getLatest.get(config.guildId, payload.userId);
      if (latest && payload.timestamp <= Number(latest.event_timestamp)) {
        send(response, 409, 'Stale account status event');
        return;
      }
      if (inFlight.has(payload.userId)) {
        send(response, 409, 'Another update for this user is in progress');
        return;
      }
      inFlight.add(payload.userId);
      try {
        const guild = await client.guilds.fetch(config.guildId);
        const member = await guild.members.fetch(payload.userId);
        await syncAccountLinkStatus(member, payload.linked);
        db.exec('BEGIN IMMEDIATE');
        try {
          recordEvent.run(payload.eventId, config.guildId, payload.userId, Number(payload.linked), payload.timestamp, Date.now());
          updateState.run(config.guildId, payload.userId, Number(payload.linked), payload.timestamp, payload.eventId);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } finally {
        inFlight.delete(payload.userId);
      }
      response.writeHead(204);
      response.end();
    } catch (error) {
      console.error('[account-link] Failed to process verified event:', error.message);
      send(response, 422, 'Could not apply account link event');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('[account-link] Trusted webhook listening on 127.0.0.1:' + port);
  });
  return server;
}
