import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const dir = mkdtempSync(join(tmpdir(), 'opus-overlay-test-'));
process.env.DB_PATH = join(dir, 'bridge.sqlite');
const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const {
  startOverlayBridge,
  confirmOverlayPairing,
  revokeOverlayAccess,
  getOverlayStatus,
  invalidateOverlayMember,
  parseOverlayEvent
} = await import('../src/services/overlayBridge.js');

test('pairing, auth, event delivery, duplicate handling and revocation', async () => {
  config.overlay = { enabled: true, eventChannelId: '555555555555555555' };
  const userId = '1474773518963970158';
  let verified = true;
  const sent = [];
  const channel = {
    guildId: config.guildId,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => false }),
    send: async message => { sent.push(message); return { id: '777777777777777777' }; }
  };
  const guild = {
    roles: { everyone: { id: 'everyone' } },
    members: { fetch: async ({ user }) => ({
      id: user,
      user: { bot: false },
      roles: { cache: { has: id => id === config.verifiedRoleId && verified } }
    }) },
    channels: { fetch: async id => id === config.overlay.eventChannelId ? channel : null }
  };
  const client = { guilds: { fetch: async id => id === config.guildId ? guild : null } };
  const server = startOverlayBridge(client, { port: 0 });
  await once(server, 'listening');
  const root = 'http://127.0.0.1:' + server.address().port;
  const post = async (path, data, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(root + path, { method: 'POST', headers, body: JSON.stringify(data) });
  };
  try {
    assert.equal((await post('/v1/overlay/events', {})).status, 401);
    const pairResponse = await post('/v1/overlay/pair', {});
    assert.equal(pairResponse.status, 201);
    const pair = await pairResponse.json();
    assert.match(pair.code, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal((await post('/v1/overlay/pair/status', { pairingId: pair.pairingId }, 'x'.repeat(43))).status, 401);
    assert.equal((await post('/v1/overlay/pair/status', { pairingId: pair.pairingId }, pair.pollToken)).status, 202);
    assert.equal(confirmOverlayPairing(userId, 'INVALIDCODE'), false);
    assert.equal(confirmOverlayPairing(userId, pair.code), true);
    assert.equal(confirmOverlayPairing(userId, pair.code), false);
    const linked = await post('/v1/overlay/pair/status', { pairingId: pair.pairingId }, pair.pollToken);
    assert.equal(linked.status, 200);
    let { accessToken } = await linked.json();
    assert.equal((await post('/v1/overlay/pair/status', { pairingId: pair.pairingId }, pair.pollToken)).status, 409);
    assert.equal(getOverlayStatus(userId).activeSessions, 1);
    const session = await fetch(root + '/v1/overlay/session', { headers: { Authorization: 'Bearer ' + accessToken } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).discordUserId, userId);
    assert.equal((await post('/v1/overlay/events', { type: 'player.identified' }, accessToken)).status, 400);
    const now = Date.now();
    const event = {
      eventId: 'overlay-test-event-0001',
      type: 'player.identified', roomId: 'BW4-DDkS-JcDS-AODI',
      gameMode: 'BedWars 4v4', occurredAt: now,
      player: {
        nickname: 'ExampleNick', realName: 'RealPlayer', rank: 'Titan', level: 82,
        guild: 'TEST', joinedAt: now - 4000,
        stats: { kdr: '2.45', fkdr: '6.82', wlr: '3.16' }
      }
    };
    assert.ok(parseOverlayEvent(event));
    assert.equal((await post('/v1/overlay/events', event, accessToken)).status, 202);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds[0].data.title, 'BedWars · Player Identified');
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    assert.equal((await post('/v1/overlay/events', event, accessToken)).status, 200);
    assert.equal(sent.length, 1);
    const refreshed = await post('/v1/overlay/session/refresh', {}, accessToken);
    assert.equal(refreshed.status, 200);
    const rotated = (await refreshed.json()).accessToken;
    assert.equal((await fetch(root + '/v1/overlay/session', { headers: { Authorization: 'Bearer ' + accessToken } })).status, 401);
    accessToken = rotated;
    assert.equal(revokeOverlayAccess(userId), 1);
    assert.equal((await fetch(root + '/v1/overlay/session', { headers: { Authorization: 'Bearer ' + accessToken } })).status, 401);
    const second = await post('/v1/overlay/pair', {});
    const pair2 = await second.json();
    assert.equal(confirmOverlayPairing(userId, pair2.code), true);
    const finalPair = await post('/v1/overlay/pair/status', { pairingId: pair2.pairingId }, pair2.pollToken);
    assert.equal(finalPair.status, 200);
    const finalToken = (await finalPair.json()).accessToken;
    verified = false;
    invalidateOverlayMember(userId);
    assert.equal((await fetch(root + '/v1/overlay/session', { headers: { Authorization: 'Bearer ' + finalToken } })).status, 401);
    assert.equal(getOverlayStatus(userId).activeSessions, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
