import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  getRoleBranches,
  roleFamily,
  roleRank,
  normalizeMemberRoles,
  planRoleChange
} from '../src/services/roleBranchPolicy.js';

const p = getRoleBranches();
const [founder, manager, admin, moderator, support] = p.staff;
const [pe, developer] = p.development;
const [backend, frontend, discord] = p.specialties;
const verified = config.verifiedRoleId;
const linked = config.linkedRoleId;
const tester = '1900000000000000021';
const artist = '1900000000000000039';
const normal = roles => [...normalizeMemberRoles(roles).roles];
const update = (roles, mode, fromId, toId) =>
  planRoleChange(roles, { mode, fromId, toId });
const same = (a, b) => assert.deepEqual(new Set(a), new Set(b));

test('Development Access is unnecessary for Manager or Developer ranks', () => {
  const access = config.developmentAccessRoleId;
  const roles = [founder, manager, pe, developer, backend, frontend];
  for (const roleId of roles) {
    assert.throws(() =>
      planRoleChange([roleId, verified], { mode: 'add', toId: access }),
      /already has Development access.*redundant/
    );
    if (roleId !== founder) {
      const normalized = normalizeMemberRoles([roleId, access, verified]);
      assert.equal(normalized.roles.has(access), false);
      assert.equal(normalized.roles.has(roleId) || roleId === backend || roleId === frontend, true);
    }
  }
  assert.doesNotThrow(() =>
    planRoleChange([moderator, verified], { mode: 'add', toId: access })
  );
});

test('server owner can change independent self roles only when explicitly permitted', () => {
  const baseline = [founder, pe, developer, verified];
  assert.throws(() =>
    planRoleChange(baseline, { mode: 'add', toId: tester, owner: true }),
    /server owner cannot be modified/
  );
  const allowed = planRoleChange(baseline, {
    mode: 'add', toId: tester, owner: true, ownerSelfIndependent: true
  });
  same(allowed.roles, [...baseline, tester]);
  assert.throws(() =>
    planRoleChange(baseline, {
      mode: 'add', toId: manager, owner: true, ownerSelfIndependent: true
    }),
    /server owner cannot be modified/
  );
  assert.throws(() =>
    planRoleChange(baseline, {
      mode: 'add', toId: config.developmentAccessRoleId, owner: true,
      ownerSelfIndependent: true
    }),
    /already has Development access.*redundant/
  );
});

test('role families use explicit IDs rather than Discord positions', () => {
  assert.equal(roleFamily(manager), 'staff');
  assert.equal(roleFamily(pe), 'development');
  assert.equal(roleFamily(backend), 'development');
  assert.equal(roleFamily(tester), null);
  assert.equal(roleRank(admin), 2);
  assert.equal(roleRank(moderator), 3);
  assert.equal(roleRank(backend), -1);
});

test('staff normalization keeps only the highest staff rank', () => {
  same(normal([admin, moderator, support, verified]), [admin, verified]);
  same(normal([manager, admin, moderator, support, pe, verified]), [manager, pe, verified]);
  same(normal([moderator, support, backend]), [moderator]);
});

test('development normalization keeps PE above Developer and drops orphan specialties', () => {
  same(normal([pe, developer, backend, frontend, verified]), [pe, verified]);
  same(normal([developer, backend, frontend, discord]), [developer, backend, frontend, discord]);
  same(normal([backend, frontend, verified]), [verified]);
});

test('Manager can hold PE or Developer plus only one functional role', () => {
  same(normal([manager, pe, developer, backend, moderator]), [manager, pe]);
  same(normal([manager, developer, frontend, discord]), [developer, frontend, discord]);
  same(normal([manager, developer, backend, verified]), [manager, developer, backend, verified]);
  same(normal([manager, admin, developer, backend]), [manager, developer, backend]);
});

test('Founder owner may hold PE and Developer together without reconciliation', () => {
  const result = normalizeMemberRoles([founder, pe, developer, backend, admin], { owner: true });
  same(result.roles, [founder, pe, developer, backend, admin]);
  assert.equal(result.changed, false);
});

test('non-owner cannot keep Founder and does not gain Staff by a Developer change', () => {
  same(normal([founder, pe, support, verified]), [pe, support, verified]);
  same(update([admin, developer, verified], 'demote', developer, null).roles, [admin, verified]);
  same(update([moderator, developer, backend, verified], 'demote', moderator, null).roles,
    [developer, backend, verified]);
});

test('demote Administrator to Support removes Moderator gap roles and preserves Developer', () => {
  const change = update([admin, moderator, support, developer, backend, verified], 'demote', admin, support);
  same(change.roles, [support, developer, backend, verified]);
  same(change.removed, [admin, moderator]);
  assert.equal(change.family, 'staff');
});

test('promote Support to Administrator removes all lower Staff ranks and preserves Development', () => {
  const change = update([support, moderator, developer, backend, verified], 'promote', moderator, admin);
  same(change.roles, [admin, developer, backend, verified]);
  same(change.removed, [moderator, support]);
  same(change.added, [admin]);
});

test('promote Support to Administrator without from also cleans lower ranks', () => {
  const change = update([support, moderator, developer, linked], 'promote', null, admin);
  same(change.roles, [admin, developer, linked]);
  same(change.removed, [support, moderator]);
});

test('promoting Administrator to Manager removes all lower Staff roles', () => {
  const change = update([admin, moderator, developer, backend], 'promote', admin, manager);
  same(change.roles, [manager, developer, backend]);
  same(change.removed, [admin, moderator]);
});

test('demoting Manager to Support keeps Engineer role and clears Staff gap', () => {
  const change = update([manager, admin, moderator, pe, verified], 'demote', manager, support);
  same(change.roles, [support, pe, verified]);
  same(change.removed, [manager, admin, moderator]);
});

test('demoting PE without destination removes Developer and specialties but not Staff', () => {
  const change = update([pe, developer, backend, frontend, moderator, tester], 'demote', pe, null);
  same(change.roles, [moderator, tester]);
  same(change.removed, [pe, developer, backend, frontend]);
});

test('demoting PE to Developer removes PE, keeps Staff and makes Developer the active rank', () => {
  const change = update([pe, developer, backend, moderator, verified], 'demote', pe, developer);
  same(change.roles, [developer, moderator, verified]);
  same(change.removed, [pe, backend]);
});

test('demoting Developer with no destination strips specialty but keeps independent roles', () => {
  const change = update([developer, backend, frontend, moderator, artist, tester], 'demote', developer, null);
  same(change.roles, [moderator, artist, tester]);
  same(change.removed, [developer, backend, frontend]);
});

test('Developer promotion to PE drops Developer and all specialized roles', () => {
  const change = update([developer, backend, moderator], 'promote', developer, pe);
  same(change.roles, [pe, moderator]);
  same(change.removed, [developer, backend]);
});

test('Developer role removal cascades into specialists and does not remove Staff', () => {
  const change = update([developer, backend, frontend, admin], 'remove', null, developer);
  same(change.roles, [admin]);
  same(change.removed, [developer, backend, frontend]);
});

test('specialized role without Developer is rejected for commands and cleaned on manual updates', () => {
  assert.throws(() => update([pe], 'add', null, backend), /Developer is required/);
  assert.throws(() => update([manager], 'promote', null, discord), /Developer is required/);
  same(normal([backend, verified]), [verified]);
});

test('Manager cannot gain more than one specialized role', () => {
  assert.throws(() => update([manager, developer, backend], 'add', null, frontend),
    /at most one/);
  same(normal([manager, developer, backend, discord]), [developer, backend, discord]);
});

test('Manager can add PE while existing Developer and staff ranks are normalized', () => {
  const change = update([manager, developer, backend, admin], 'add', null, pe);
  same(change.roles, [manager, pe]);
  same(change.removed, [admin, developer, backend]);
});

test('Developer and Staff roles stay independent across both promote directions', () => {
  same(update([support, developer], 'promote', null, admin).roles, [admin, developer]);
  same(update([admin, developer], 'promote', null, pe).roles, [admin, pe]);
});

test('promote from auxiliary Beta Tester into Developer affects no Staff role', () => {
  const change = update([tester, moderator, artist], 'promote', tester, developer);
  same(change.roles, [developer, moderator, artist]);
  same(change.removed, [tester]);
});

test('unrelated Beta Tester and Artist survive Staff or Development demotions', () => {
  same(update([admin, tester, artist, developer], 'demote', admin, null).roles,
    [tester, artist, developer]);
  same(update([developer, tester, artist, moderator], 'demote', developer, null).roles,
    [tester, artist, moderator]);
});

test('Staff and Development cannot be crossed using from_role', () => {
  assert.throws(() => update([moderator], 'promote', moderator, pe), /independent branches/);
  assert.throws(() => update([developer], 'demote', developer, support), /independent branches/);
});

test('promote must not silently demote an existing higher rank', () => {
  assert.throws(() => update([admin, moderator], 'promote', moderator, support), /higher rank|higher rank|destination/);
  assert.throws(() => update([manager, moderator], 'add', null, admin), /higher rank/);
  assert.throws(() => update([pe], 'add', null, developer), /higher rank|concurrently/);
});

test('demote requires highest source, but promote permits any lower source when going upwards', () => {
  assert.throws(() => update([admin, moderator], 'demote', moderator, support), /highest rank/);
  same(update([support, moderator, developer], 'promote', support, admin).roles, [admin, developer]);
  assert.throws(() => update([manager, moderator, support], 'promote', support, admin), /higher rank/);
});

test('demotion to unrelated rank and bad direction are rejected', () => {
  assert.throws(() => update([admin], 'demote', admin, pe), /independent/);
  assert.throws(() => update([moderator], 'demote', moderator, admin), /lower rank/);
  assert.throws(() => update([admin], 'promote', admin, support), /higher rank/);
});

test('demoting a support role without destination retains Developer, Linked and Verified', () => {
  const change = update([support, developer, linked, verified], 'demote', support, null);
  same(change.roles, [developer, linked, verified]);
});

test('adding a Staff rank via role add automatically removes conflicting lower staff roles', () => {
  same(update([moderator, support, backend, developer], 'add', null, admin).roles,
    [admin, developer, backend]);
});

test('idempotence is stable after normalization in both directions', () => {
  const samples = [
    [admin, moderator, support, developer, backend],
    [manager, pe, developer, backend, moderator],
    [developer, frontend, discord, tester],
    [support, artist, linked, verified],
    [pe, backend, moderator]
  ];
  for (const original of samples) {
    const once = normalizeMemberRoles(original);
    const twice = normalizeMemberRoles(once.roles);
    same(once.roles, twice.roles);
    assert.equal(twice.changed, false);
  }
});

test('exhaustive normalization for all 1024 Staff and Development combinations', () => {
  const ids = [...p.staff, ...p.development, ...p.specialties];
  for (let bits = 0; bits < 1024; bits++) {
    const source = ids.filter((id, index) => (bits & (1 << index)) !== 0);
    const first = normalizeMemberRoles(source);
    const second = normalizeMemberRoles(first.roles);
    assert.equal(second.changed, false, 'idempotence failed for bitset ' + bits);
    assert.deepEqual(first.roles, second.roles);
    const current = first.roles;
    assert.ok(!current.has(founder), 'non-owner held Founder');
    assert.ok(p.staff.filter(id => current.has(id)).length <= 1, 'duplicate Staff rank');
    assert.ok(p.development.filter(id => current.has(id)).length <= 1, 'duplicate Development rank');
    if (!current.has(developer)) {
      assert.equal(p.specialties.filter(id => current.has(id)).length, 0, 'orphan specialist');
    }
    if (current.has(discord)) {
      assert.ok(current.has(developer), 'Discord Developer missing Developer');
      assert.equal(p.staff.filter(id => current.has(id)).length, 0, 'Discord Developer holds Staff');
    }
    if (current.has(manager)) {
      assert.equal(p.staff.filter(id => current.has(id)).length, 1, 'Manager holds other staff');
      assert.ok(p.specialties.filter(id => current.has(id)).length <= 1, 'Manager holds two specialties');
      if (current.has(pe)) assert.ok(!current.has(developer), 'Manager holds PE and Developer');
    }
  }
});

test('a Development demotion never changes valid Staff rank and vice versa', () => {
  const ranks = [admin, moderator, support];
  const devRanks = [pe, developer];
  for (const staff of ranks) {
    for (const dev of devRanks) {
      const source = [staff, dev, verified];
      const demoteDev = update(source, 'demote', dev, null);
      assert.ok(demoteDev.roles.has(staff), 'Staff rank was removed by Development demote');
      const demoteStaff = update(source, 'demote', staff, null);
      assert.ok(demoteStaff.roles.has(dev), 'Development rank was removed by Staff demote');
    }
  }
});

test('ordinary Developers and Principal Engineers may retain one independently ranked Staff role', () => {
  same(normal([developer, backend, admin, moderator, verified]), [developer, backend, admin, verified]);
  same(normal([pe, support, verified]), [pe, support, verified]);
  same(update([developer, backend, support], 'promote', support, admin).roles, [developer, backend, admin]);
  same(update([pe, admin, moderator], 'demote', admin, support).roles, [pe, support]);
  same(update([developer, backend, admin, moderator], 'demote', admin, null).roles, [developer, backend]);
});

test('Discord Developer automatically clears all Staff rank roles on assignment', () => {
  const promoted = update([developer, moderator, support, verified], 'add', null, discord);
  same(promoted.roles, [developer, discord, verified]);
  same(promoted.removed, [moderator, support]);
  const promotedManager = update([manager, developer, backend], 'add', null, discord);
  same(promotedManager.roles, [developer, backend, discord]);
  same(promotedManager.removed, [manager]);
});

test('Discord Developer cannot receive Staff roles until specialization is removed', () => {
  for (const id of [manager, admin, moderator, support]) {
    assert.throws(() => update([developer, discord, verified], 'add', null, id), /cannot hold a Staff branch role/);
    assert.throws(() => update([developer, discord, verified], 'promote', null, id), /cannot hold a Staff branch role/);
  }
  const withoutDiscord = update([developer, discord, verified], 'remove', null, discord);
  same(update(withoutDiscord.roles, 'add', null, moderator).roles, [developer, verified, moderator]);
});

test('Discord Developer retains independent Developer specialties but not Manager or lower Staff', () => {
  same(normal([manager, developer, backend, discord, admin, verified]), [developer, backend, discord, verified]);
  same(normal([developer, discord, frontend, admin, support, verified]), [developer, discord, frontend, verified]);
  same(normal([discord, admin, verified]), [admin, verified]);
  same(normal([manager, pe, discord]), [manager, pe]);
});

test('Staff demotion remains independent for non-Discord Developers', () => {
  for (const staffRole of [admin, moderator, support]) {
    for (const devRole of [pe, developer]) {
      const input = [devRole, staffRole, verified];
      const cleared = update(input, 'demote', staffRole, null);
      assert.ok(cleared.roles.has(devRole), 'Development role changed when Staff rank demoted');
      assert.ok(!cleared.roles.has(staffRole), 'Staff role not cleared');
    }
  }
});
