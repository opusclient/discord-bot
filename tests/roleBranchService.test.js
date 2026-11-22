import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  reconcileRoleBranches,
  reconcileAllRoleBranches
} from '../src/services/roleBranchService.js';

const p = config.roleBranches;
const [founder, manager, admin, moderator, support] = p.staff;
const [pe, developer] = p.development;
const [backend, frontend, discord] = p.specialties;
const verified = config.verifiedRoleId;
const nameMap = new Map([
  [founder, 'Founder'],
  [manager, 'Manager'],
  [admin, 'Adminstrator'],
  [moderator, 'Moderator'],
  [support, 'Support'],
  [pe, 'Principal Engineer'],
  [developer, 'Developer'],
  [backend, 'Backend Developer'],
  [frontend, 'Frontend Developer'],
  [discord, 'Discord Developer'],
  [verified, 'Verified']
]);
const positions = new Map([
  [founder, 21], [manager, 20], [admin, 13], [moderator, 12], [support, 11],
  [pe, 19], [developer, 18], [backend, 17], [frontend, 16], [discord, 15],
  [verified, 6]
]);

function setup(memberIds, { owner = false, failSet = false } = {}) {
  const memberId = owner ? '1320303839701897230' : '123456789012345678';
  const roleCache = new Map([...nameMap].map(([id, name]) => [id, {
    id, name, position: positions.get(id), managed: false
  }]));
  const assigned = new Map(memberIds.map(id => [id, roleCache.get(id)]));
  const calls = [];
  const guild = {
    id: config.guildId,
    ownerId: '1320303839701897230',
    roles: {
      cache: roleCache,
      fetch: async () => roleCache
    },
    members: {
      me: { roles: { highest: { position: 22 } } },
      fetch: async arg => typeof arg === 'object' && 'user' in arg
        ? member
        : new Map([[memberId, member]])
    }
  };
  const member = {
    guild,
    id: memberId,
    user: { bot: false },
    roles: {
      cache: assigned,
      set: async (target, reason) => {
        if (failSet) throw new Error('simulated Discord rejection');
        calls.push({ target, reason });
        assigned.clear();
        for (const id of target) assigned.set(id, roleCache.get(id));
      }
    }
  };
  return { member, guild, calls, assigned };
}

const same = (a, b) => assert.deepEqual(new Set(a), new Set(b));

test('manual removal of Developer automatically strips unsupported developer specialties', async () => {
  const fixture = setup([backend, frontend, moderator, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [moderator, verified]);
  same(result.removed, [backend, frontend]);
  assert.equal(fixture.calls.length, 1);
});

test('manual Manager assignment strips lower Staff ranks and incompatible developer base', async () => {
  const fixture = setup([manager, admin, moderator, pe, developer, backend, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [manager, pe, verified]);
  same(result.removed, [admin, moderator, developer, backend]);
});

test('Manager Developer branch can retain only one functional specialization', async () => {
  const fixture = setup([manager, developer, backend, frontend, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [manager, developer, backend, verified]);
  same(result.removed, [frontend]);
});

test('manual role changes that are valid do not generate writes', async () => {
  const fixture = setup([moderator, developer, frontend, verified]);
  assert.equal((await reconcileRoleBranches(fixture.member)).status, 'unchanged');
  assert.equal(fixture.calls.length, 0);
});

test('repeated member-update callbacks converge on one stable role state', async () => {
  const fixture = setup([manager, admin, moderator, developer, frontend, discord, verified]);
  const results = await Promise.all(Array.from({ length: 12 }, () => reconcileRoleBranches(fixture.member)));
  same(fixture.assigned.keys(), [developer, frontend, discord, verified]);
  assert.equal(results.filter(result => result.status === 'corrected').length, 1);
  assert.equal(fixture.calls.length, 1);
});

test('bot role edits do not delete a parallel branch', async () => {
  const fixture = setup([pe, developer, backend, support, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [pe, support, verified]);
  same(result.removed, [developer, backend]);
});

test('Discord failures do not partially clear the member role set', async () => {
  const fixture = setup([backend, moderator, verified], { failSet: true });
  await assert.rejects(reconcileRoleBranches(fixture.member), /simulated Discord rejection/);
  same(fixture.assigned.keys(), [backend, moderator, verified]);
});

test('Founder owner is excluded from automatic role mutation', async () => {
  const fixture = setup([founder, pe, developer, backend, admin], { owner: true });
  assert.equal((await reconcileRoleBranches(fixture.member)).status, 'ignored');
  assert.equal(fixture.calls.length, 0);
});

test('startup reconciliation checks branch IDs and corrects manual role drift', async () => {
  const fixture = setup([admin, moderator, developer, discord, verified]);
  const outcome = await reconcileAllRoleBranches(fixture.guild);
  assert.deepEqual(outcome, { scanned: 1, corrected: 1, unchanged: 0, failed: 0 });
  same(fixture.assigned.keys(), [developer, discord, verified]);
});

test('manual Staff assignment to Discord Developer is immediately removed', async () => {
  const fixture = setup([developer, discord, admin, moderator, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [developer, discord, verified]);
  same(result.removed, [admin, moderator]);
});

test('manually granted Discord Developer clears existing Manager while preserving Developer', async () => {
  const fixture = setup([manager, developer, backend, discord, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'corrected');
  same(fixture.assigned.keys(), [developer, backend, discord, verified]);
  same(result.removed, [manager]);
});

test('ordinary Developer retains a Staff role and its own branch on manual updates', async () => {
  const fixture = setup([developer, backend, moderator, verified]);
  const result = await reconcileRoleBranches(fixture.member);
  assert.equal(result.status, 'unchanged');
  same(fixture.assigned.keys(), [developer, backend, moderator, verified]);
  assert.equal(fixture.calls.length, 0);
});
