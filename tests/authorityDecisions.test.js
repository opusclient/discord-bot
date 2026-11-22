import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AuthorityDecisionStore, planRoleRestoration } from '../src/services/authorityDecisions.js';

const guildId = '1566400594267213887';
const ownerId = '111111111111111111';
const managerId = '222222222222222222';
const offenderId = '333333333333333333';
const userId = '444444444444444444';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const store = new AuthorityDecisionStore(db);
  const incident = store.open({
    guildId, incidentKey: 'audit-1', level: 3,
    executorId: offenderId, targetId: userId, beneficiaryId: userId,
    beforeRoles: ['verified'], afterRoles: ['verified', 'developer']
  });
  return { db, store, incident };
}

test('Manager may keep an unrelated level 3 incident but Founder can veto afterwards', async () => {
  const { db, store, incident } = fixture();
  const kept = await store.decide({
    incidentId: incident.id, actorId: managerId, ownerId,
    actorIsManager: true, action: 'keep'
  });
  assert.equal(kept.status, 'kept_manager');
  assert.equal(kept.decision_actor_id, managerId);
  let observed = null;
  const veto = await store.decide({
    incidentId: incident.id, actorId: ownerId, ownerId, action: 'restore',
    restore: async row => {
      observed = row;
      return { verified: true };
    }
  });
  assert.equal(observed.status, 'restore_pending');
  assert.deepEqual(observed.beforeRoles, ['verified']);
  assert.equal(veto.status, 'founder_revoked');
  assert.equal(veto.decision_actor_id, managerId);
  assert.equal(veto.restoration_actor_id, ownerId);
  assert.deepEqual(store.journal(guildId, incident.id).map(e => e.event_type), [
    'incident_opened', 'manager_keep', 'founder_veto_requested', 'founder_veto_applied'
  ]);
  assert.equal(store.verifyJournal(guildId), true);
  db.close();
});

test('Manager cannot review an incident that involves them or the beneficiary', async () => {
  const { db, store, incident } = fixture();
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: userId,
    ownerId, actorIsManager: true, action: 'keep' }), /involved/);
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: offenderId,
    ownerId, actorIsManager: true, action: 'restore', restore: async () => ({ verified: true }) }), /involved/);
  assert.equal(store.get(incident.id).status, 'pending');
  db.close();
});

test('Another Manager cannot overturn an earlier Manager decision', async () => {
  const { db, store, incident } = fixture();
  await store.decide({ incidentId: incident.id, actorId: managerId, ownerId, actorIsManager: true, action: 'keep' });
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: '555555555555555555',
    ownerId, actorIsManager: true, action: 'restore', restore: async () => ({ verified: true }) }), /Only Founder/);
  db.close();
});

test('Failed restoration leaves case visible and journaled for Founder review', async () => {
  const { db, store, incident } = fixture();
  await store.decide({ incidentId: incident.id, actorId: managerId, ownerId, actorIsManager: true, action: 'keep' });
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: ownerId,
    ownerId, action: 'restore', restore: async () => { throw new Error('Role hierarchy prevents restoration'); } }), /Role hierarchy/);
  assert.equal(store.get(incident.id).status, 'restore_failed');
  assert.equal(store.pendingRestores(guildId).length, 1);
  assert.equal(store.verifyJournal(guildId), true);
  db.close();
});

test('Restoration is not finalized without verified Discord state', async () => {
  const { db, store, incident } = fixture();
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: ownerId,
    ownerId, action: 'restore', restore: async () => ({ verified: false }) }), /not verified/);
  assert.equal(store.get(incident.id).status, 'restore_failed');
  db.close();
});

test('Incidents are idempotent and hash-chain tampering is detected', () => {
  const { db, store, incident } = fixture();
  const again = store.open({ guildId, incidentKey: 'audit-1', level: 2, beforeRoles: [], afterRoles: [] });
  assert.equal(again.id, incident.id);
  assert.equal(store.verifyJournal(guildId), true);
  db.prepare('UPDATE authority_decision_journal SET payload_json = ? WHERE id = 1').run('{"tampered":true}');
  assert.equal(store.verifyJournal(guildId), false);
  db.close();
});

test('Only Founder or unrelated Manager may resolve incidents', async () => {
  const { db, store, incident } = fixture();
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: '666666666666666666',
    ownerId, action: 'keep' }), /Only Founder/);
  const founder = await store.decide({ incidentId: incident.id, actorId: ownerId,
    ownerId, action: 'keep' });
  assert.equal(founder.status, 'kept_founder');
  await assert.rejects(store.decide({ incidentId: incident.id, actorId: managerId,
    ownerId, actorIsManager: true, action: 'restore',
    restore: async () => ({ verified: true }) }), /Only Founder/);
  db.close();
});

test('Founder veto reverts only incident role delta without removing later unrelated roles', () => {
  const incident = {
    beforeRoles: ['verified'],
    afterRoles: ['verified', 'developer']
  };
  assert.deepEqual(planRoleRestoration(incident, ['verified', 'developer', 'artist']), ['artist', 'verified']);
  assert.throws(() => planRoleRestoration(incident, ['verified', 'developer', 'artist'], {
    conflictRoleIds: ['developer']
  }), /Later authorized changes/);
  assert.throws(() => planRoleRestoration(incident, ['verified', 'artist']), /Observed role drift/);
});

test('Automatic restoration records bot identity instead of impersonating Founder', async () => {
  const { db, store, incident } = fixture();
  const botId = '777777777777777777';
  const restored = await store.autoRestore({
    incidentId: incident.id, botId, restore: async () => ({ verified: true })
  });
  assert.equal(restored.status, 'restored');
  assert.equal(restored.restoration_actor_id, botId);
  assert.deepEqual(store.journal(guildId, incident.id).map(e => e.event_type), [
    'incident_opened', 'automatic_restore_requested', 'automatic_restore_verified'
  ]);
  assert.equal(store.verifyJournal(guildId), true);
  db.close();
});
