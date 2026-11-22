import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { completeVerification, syncAccountLinkStatus, reconcileVerifiedMembers } from '../src/services/accountRoles.js';

const names = {
  verified: 'Verified',
  unlinked: 'Unlinked',
  linked: 'Linked'
};

function makeGuild(initial = []) {
  const found = new Set(initial);
  const roles = Object.fromEntries(Object.keys(names).map(key => [
    key,
    { id: config[key + 'RoleId'], name: names[key], managed: false }
  ]));
  const assigned = new Map(Object.values(roles).filter(role => found.has(role.id)).map(role => [role.id, role]));
  const member = {
    id: '1474773518963970158',
    user: { bot: false },
    roles: {
      cache: assigned,
      add: async role => { found.add(role.id); assigned.set(role.id, role); },
      remove: async role => { found.delete(role.id); assigned.delete(role.id); }
    }
  };
  const guild = {
    id: config.guildId,
    roles: {
      cache: new Map(Object.values(roles).map(role => [role.id, role])),
      fetch: async id => Object.values(roles).find(role => role.id === id) ?? null
    },
    members: { fetch: async args => args?.user ? member : new Map([[member.id, member]]) }
  };
  member.guild = guild;
  return { guild, member, found, roles };
}

test('verify grants Verified + Unlinked and is idempotent', async () => {
  const { member, found, roles } = makeGuild();
  const first = await completeVerification(member);
  assert.equal(first.verified, true);
  assert.equal(found.has(roles.verified.id), true);
  assert.equal(found.has(roles.unlinked.id), true);
  assert.equal(found.has(roles.linked.id), false);
  const second = await completeVerification(member);
  assert.equal(second.already, true);
  assert.equal(found.size, 2);
});

test('existing verified and linked user does not regress to Unlinked', async () => {
  const { member, found, roles } = makeGuild([config.verifiedRoleId, config.linkedRoleId]);
  const result = await completeVerification(member);
  assert.equal(result.already, true);
  assert.equal(found.has(roles.linked.id), true);
  assert.equal(found.has(roles.unlinked.id), false);
});

test('trusted link status transitions are exclusive and reversible', async () => {
  const { member, found, roles } = makeGuild([config.verifiedRoleId, config.unlinkedRoleId]);
  await syncAccountLinkStatus(member, true);
  assert.equal(found.has(roles.linked.id), true);
  assert.equal(found.has(roles.unlinked.id), false);
  await syncAccountLinkStatus(member, false);
  assert.equal(found.has(roles.unlinked.id), true);
  assert.equal(found.has(roles.linked.id), false);
});

test('unverified users cannot be granted Linked', async () => {
  const { member } = makeGuild();
  await assert.rejects(syncAccountLinkStatus(member, true), /must be verified/);
});

test('reconciliation fills missing statuses for previously verified users', async () => {
  const { guild, found, roles } = makeGuild([config.verifiedRoleId]);
  const changed = await reconcileVerifiedMembers(guild);
  assert.equal(changed, 1);
  assert.equal(found.has(roles.unlinked.id), true);
});
