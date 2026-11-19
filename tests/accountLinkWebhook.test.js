import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';

const dir = mkdtempSync(join(tmpdir(), 'opus-link-test-'));
process.env.DB_PATH = join(dir, 'test.sqlite');
process.env.OPUS_LINK_WEBHOOK_SECRET = 'test-secret-that-has-more-than-thirty-two-characters';
process.env.OPUS_LINK_WEBHOOK_PORT = String(20000 + process.pid % 30000);

const { config } = await import('../src/config.js');
const { startAccountLinkWebhook } = await import('../src/services/accountLinkWebhook.js');
const { db } = await import('../src/db.js');

test('signed account-link events are validated, idempotent and ordered', async () => {
  const held = new Set([config.verifiedRoleId, config.unlinkedRoleId]);
  const roles = new Map([
    [config.verifiedRoleId, {id: config.verifiedRoleId, name: 'Verified', managed: false}],
    [config.unlinkedRoleId, {id: config.unlinkedRoleId, name: 'Unlinked', managed: false}],
    [config.linkedRoleId, {id: config.linkedRoleId, name: 'Linked', managed: false}]
  ]);
  const guild = {
    roles: { fetch: async id => roles.get(id) ?? null },
    members: { fetch: async id => {
      if (id !== '1474773518963970158') throw new Error('Wrong user');
      return member;
    }}
  };
  const member = {
    id: '1474773518963970158',
    user: { bot: false },
    guild,
    roles: {
      cache: { has: id => held.has(id) },
      add: async role => { held.add(role.id); },
      remove: async role => { held.delete(role.id); }
    }
  };
  const client = { guilds: { fetch: async id => {
    if (id !== config.guildId) throw new Error('Wrong guild');
    return guild;
  }}};
  const server = startAccountLinkWebhook(client);
  await once(server, 'listening');
  const address = 'http://127.0.0.1:' + process.env.OPUS_LINK_WEBHOOK_PORT + '/internal/account-link';
  const send = async (payload, valid = true) => {
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', valid ? process.env.OPUS_LINK_WEBHOOK_SECRET : 'wrong')
      .update(raw).digest('hex');
    return fetch(address, {method:'POST',headers:{'x-opus-signature':'sha256='+signature},body:raw});
  };
  try {
    const time = Date.now();
    const event = {guildId:config.guildId,userId:member.id,linked:true,timestamp:time,eventId:'signed-link-0001'};
    assert.equal((await send(event,false)).status,401);
    assert.equal(held.has(config.linkedRoleId),false);
    assert.equal((await send(event)).status,204);
    assert.equal(held.has(config.linkedRoleId),true);
    assert.equal(held.has(config.unlinkedRoleId),false);
    assert.equal((await send(event)).status,409);
    assert.equal((await send({...event,linked:false,eventId:'signed-unlink-0002',timestamp:time-1})).status,409);
    assert.equal((await send({...event,linked:false,eventId:'signed-unlink-0003',timestamp:time+1})).status,204);
    assert.equal(held.has(config.unlinkedRoleId),true);
    assert.equal(held.has(config.linkedRoleId),false);
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
