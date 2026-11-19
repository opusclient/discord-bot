import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'opus-role-ops-'));
process.env.DB_PATH = join(dir, 'roles.sqlite');
const { db } = await import('../src/db.js');
const { getTeamRoleHistory } = await import('../src/services/teamRoleHistory.js');
const { config } = await import('../src/config.js');
const { parseUserList, executeRoleOperation, MAX_ROLE_TARGETS } = await import('../src/services/roleOperations.js');
const { data: roleDefinition } = await import('../src/commands/role.js');
const { data: promoteDefinition } = await import('../src/commands/promote.js');
const { data: demoteDefinition } = await import('../src/commands/demote.js');
const policy = config.roleBranches;
const [founder, manager, admin, moderator, support] = policy.staff;
const [principal, developer] = policy.development;
const [backend, frontend, discord] = policy.specialties;
const tester = '1900000000000000021';
const artist = '1900000000000000039';
const verified = config.verifiedRoleId;
const linked = config.linkedRoleId;

const ids = {
  first: '123456789012345678',
  second: '123456789012345679',
  owner: '123456789012345680',
  manager: '123456789012345681',
  bot: '123456789012345682'
};

function role(id, name, position) {
  return { id, name, position, managed: false };
}

const roleList = [
  role(founder, 'Founder', 21),
  role(manager, 'Manager', 20),
  role(principal, 'Principal Engineer', 19),
  role(developer, 'Developer', 18),
  role(backend, 'Backend Developer', 17),
  role(frontend, 'Frontend Developer', 16),
  role(discord, 'Discord Developer', 15),
  role(admin, 'Adminstrator', 13),
  role(moderator, 'Moderator', 12),
  role(support, 'Support', 11),
  role(tester, 'Beta Tester', 7),
  role(artist, 'Artist', 8),
  role(verified, 'Verified', 6),
  role(linked, 'Linked', 2)
];
const roleCache = new Map(roleList.map(item => [item.id, item]));

function makeMember(id, roleIds) {
  const cache = new Map(roleIds.map(item => [item, roleCache.get(item)]));
  const calls = [];
  const member = {
    id,
    displayName: 'Member ' + id,
    roles: {
      cache,
      get highest() {
        return [...cache.values()].reduce((a, b) => (a.position > b.position ? a : b), role('0', '@everyone', 0));
      },
      set: async (next, reason) => {
        calls.push({ type: 'set', before: [...cache.keys()], after: [...next], reason });
        cache.clear();
        for (const roleId of next) {
          const target = roleCache.get(roleId);
          if (!target) throw new Error('Unknown mock role: ' + roleId);
          cache.set(roleId, target);
        }
      }
    },
    user: {
      id, bot: false, sent: [],
      send: async function (payload) { this.sent.push(payload); }
    }
  };
  return { member, calls };
}

function makeInteraction(mode, users, toRole, fromRole, members) {
  const actorRole = role('123456789012345683', 'Test Actor', 100);
  const botRole = role('123456789012345684', 'Test Bot', 110);
  const guild = {
    id: config.guildId,
    ownerId: ids.owner,
    name: 'Opus Client',
    iconURL: () => null,
    members: {
      me: { id: ids.bot, permissions: { has: () => true }, roles: { highest: botRole } },
      fetch: async target => {
        const key = typeof target === 'string' ? target : target?.user;
        return members.get(key)?.member ?? null;
      }
    },
    roles: {
      everyone: { id: config.guildId },
      cache: roleCache,
      fetch: async id => roleCache.get(id) ?? null
    },
    channels: { cache: new Map(), fetch: async () => null }
  };
  for (const entry of members.values()) entry.member.guild = guild;
  const changes = [];
  const interaction = {
    guildId: config.guildId,
    guild,
    id: '123456789012345695',
    user: { id: ids.manager, tag: 'manager' },
    member: { permissions: { has: () => true }, roles: { highest: actorRole } },
    options: {
      getString: key => key === 'users' ? users : key === 'reason' ? 'Team update' : null,
      getRole: key => key === 'role' || key === 'to_role' ? toRole : key === 'from_role' ? fromRole : null
    },
    deferReply: async value => { changes.push(['defer', value]); },
    editReply: async value => {
      changes.push(['edit', value]);
      return { createMessageComponentCollector: () => null };
    }
  };
  return { interaction, changes };
}

const same = (a, b) => assert.deepEqual(new Set(a), new Set(b));
const getRole = id => roleCache.get(id);
const resultText = result => JSON.stringify(result);

test('bulk parser supports IDs, mentions and deduplication', () => {
  assert.deepEqual(parseUserList(ids.first + ', <@!' + ids.second + '>, <@' + ids.first + '>').ids, [ids.first, ids.second]);
  assert.deepEqual(parseUserList(ids.first + '\n' + ids.second).ids, [ids.first, ids.second]);
  assert.match(parseUserList('invalid user').error, /Invalid user/);
  assert.match(parseUserList('').error, /at least one/);
  assert.equal(MAX_ROLE_TARGETS, 50);
  assert.match(parseUserList(Array.from({ length: 51 }, (_, i) => String(100000000000000000n + BigInt(i))).join(',')).error, /50/);
});

test('promote and demote slash command requirements stay asymmetric', () => {
  const command = roleDefinition.toJSON();
  assert.deepEqual(command.options.map(x => x.name), ['add', 'remove']);
  const promote = promoteDefinition.toJSON();
  const demote = demoteDefinition.toJSON();
  assert.deepEqual(promote.options.map(x => x.name), ['users', 'to_role', 'from_role', 'reason']);
  assert.deepEqual(demote.options.map(x => x.name), ['users', 'from_role', 'to_role', 'reason']);
  assert.equal(promote.options[1].required, true);
  assert.equal(promote.options[2].required, false);
  assert.equal(demote.options[1].required, true);
  assert.equal(demote.options[2].required, false);
});

test('Adminstrator with Moderator demoted to Support removes both and preserves Developer branch', async () => {
  const user = makeMember(ids.first, [admin, moderator, developer, backend, verified]);
  const { interaction } = makeInteraction('demote', ids.first, getRole(support), getRole(admin),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'demote');
  assert.deepEqual(result.success, [ids.first]);
  assert.equal(user.calls.length, 1);
  same(user.member.roles.cache.keys(), [support, developer, backend, verified]);
  same(result.records[0].removedRoles.map(x => x.id), [admin, moderator]);
  assert.equal(result.records[0].historySaved, true);
  const saved = getTeamRoleHistory(config.guildId, ids.first);
  assert.equal(saved.total, 1);
  assert.equal(saved.rows[0].mode, 'demote');
  assert.equal(saved.rows[0].from_role_name, 'Adminstrator');
  assert.equal(saved.rows[0].to_role_name, 'Support');
  assert.deepEqual(saved.rows[0].removedRoles.map(role => role.name), ['Adminstrator', 'Moderator']);
  const dm = user.member.user.sent[0];
  assert.equal(dm.flags, MessageFlags.IsComponentsV2);
  const text = resultText(dm.components[0].toJSON());
  assert.match(text, /Roles removed \(2\)/);
  assert.match(text, /Adminstrator/);
  assert.match(text, /Moderator/);
  assert.match(text, /Support/);
});

test('Support promoted to Adminstrator removes the lower Staff roles while retaining Developer', async () => {
  const user = makeMember(ids.first, [support, moderator, developer, frontend, linked]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(admin), getRole(moderator),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [admin, developer, frontend, linked]);
  same(result.records[0].removedRoles.map(x => x.id), [support, moderator]);
  assert.match(resultText(user.member.user.sent[0]), /Roles removed \(2\)/);
});

test('PE demoted with no destination clears Developer and specialist roles, preserves Staff', async () => {
  const user = makeMember(ids.first, [principal, developer, backend, moderator, verified]);
  const { interaction } = makeInteraction('demote', ids.first, null, getRole(principal),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'demote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [moderator, verified]);
  same(result.records[0].removedRoles.map(x => x.id), [principal, developer, backend]);
  assert.equal(result.records[0].regularMember, false);
  const text = resultText(user.member.user.sent[0]);
  assert.match(text, /Development Branch Cleared/);
  assert.match(text, /Roles removed \(3\)/);
});

test('Developer demoted with no destination becomes regular while keeping account roles', async () => {
  const user = makeMember(ids.first, [developer, backend, verified, linked]);
  const { interaction } = makeInteraction('demote', ids.first, null, getRole(developer),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'demote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [verified, linked]);
  assert.equal(result.records[0].regularMember, true);
  assert.match(resultText(user.member.user.sent[0]), /Regular Member/);
});

test('promote to PE without from cleans lower Development rank but not Staff', async () => {
  const user = makeMember(ids.first, [developer, backend, admin, verified]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(principal), null,
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [principal, admin, verified]);
  same(result.records[0].removedRoles.map(x => x.id), [developer, backend]);
});

test('promote Beta Tester into Developer removes only Tester, keeps Moderator and Artist', async () => {
  const user = makeMember(ids.first, [tester, moderator, artist, verified]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(developer), getRole(tester),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [developer, moderator, artist, verified]);
  same(result.records[0].removedRoles.map(x => x.id), [tester]);
});

test('role remove Developer cascades specialties but keeps Moderator and Artist', async () => {
  const user = makeMember(ids.first, [developer, frontend, discord, moderator, artist]);
  const { interaction } = makeInteraction('remove', ids.first, getRole(developer), null,
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'remove');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [moderator, artist]);
  same(result.records[0].removedRoles.map(x => x.id), [developer, frontend, discord]);
});

test('promote without from to Staff cleans lower Staff ranks', async () => {
  const user = makeMember(ids.first, [moderator, support, developer, linked]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(admin), null,
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, [ids.first]);
  same(user.member.roles.cache.keys(), [admin, developer, linked]);
});

test('unrelated Staff to Development role swap is rejected before mutation', async () => {
  const user = makeMember(ids.first, [moderator, verified]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(principal), getRole(moderator),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, []);
  assert.equal(user.calls.length, 0);
  assert.match(result.records[0].error, /independent branches/);
});

test('no DM delivery never undoes a successfully applied role update', async () => {
  const user = makeMember(ids.first, [support, verified]);
  user.member.user.send = async () => { throw new Error('DMs disabled'); };
  const { interaction } = makeInteraction('promote', ids.first, getRole(admin), getRole(support),
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'promote');
  assert.deepEqual(result.success, [ids.first]);
  assert.deepEqual(result.dmFailed, [ids.first]);
  same(user.member.roles.cache.keys(), [admin, verified]);
});

test('removing a role that is not held fails without mutations', async () => {
  const user = makeMember(ids.first, [verified]);
  const { interaction } = makeInteraction('remove', ids.first, getRole(developer), null,
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'remove');
  assert.deepEqual(result.success, []);
  assert.equal(user.calls.length, 0);
  assert.match(result.records[0].error, /does not have/);
});

test('no source on demote must fail without mutations', async () => {
  const user = makeMember(ids.first, [admin]);
  const { interaction, changes } = makeInteraction('demote', ids.first, getRole(support), null,
    new Map([[ids.first, user]]));
  const result = await executeRoleOperation(interaction, 'demote');
  assert.equal(user.calls.length, 0);
  assert.match(changes.at(-1)[1].embeds[0].toJSON().description, /from_role/);
});

test('member at or above caller hierarchy cannot be mutated', async () => {
  const user = makeMember(ids.first, [admin]);
  const { interaction } = makeInteraction('promote', ids.first, getRole(manager), getRole(admin),
    new Map([[ids.first, user]]));
  interaction.member.roles.highest.position = 12;
  await executeRoleOperation(interaction, 'promote');
  assert.equal(user.calls.length, 0);
});

test('Manager can add and remove an independent role on themselves', async () => {
  const user = makeMember(ids.manager, [manager, verified]);
  const members = new Map([[ids.manager, user]]);
  const assign = makeInteraction('add', ids.manager, getRole(artist), null, members);
  assign.interaction.member.roles.cache = new Map([[manager, getRole(manager)]]);
  assign.interaction.member.roles.highest = getRole(manager);
  const added = await executeRoleOperation(assign.interaction, 'add');
  assert.deepEqual(added.success, [ids.manager]);
  same(user.member.roles.cache.keys(), [manager, verified, artist]);
  assert.equal(user.calls.length, 1);

  const remove = makeInteraction('remove', ids.manager, getRole(artist), null, members);
  remove.interaction.member.roles.cache = new Map([[manager, getRole(manager)]]);
  remove.interaction.member.roles.highest = getRole(manager);
  const removed = await executeRoleOperation(remove.interaction, 'remove');
  assert.deepEqual(removed.success, [ids.manager]);
  same(user.member.roles.cache.keys(), [manager, verified]);
  assert.equal(user.calls.length, 2);
});

test('Manager self-assignment of Development Access fails because Manager already has Dev permissions', async () => {
  const roleId = config.developmentAccessRoleId;
  const accessRole = role(roleId, 'Development Access', 9);
  roleCache.set(roleId, accessRole);
  const user = makeMember(ids.manager, [manager, verified]);
  const { interaction } = makeInteraction('add', ids.manager, accessRole, null,
    new Map([[ids.manager, user]]));
  interaction.member.roles.cache = new Map([[manager, getRole(manager)]]);
  interaction.member.roles.highest = getRole(manager);
  const result = await executeRoleOperation(interaction, 'add');
  assert.deepEqual(result.success, []);
  assert.equal(user.calls.length, 0);
  assert.match(result.records[0].error, /already has Development access.*redundant/i);
  same(user.member.roles.cache.keys(), [manager, verified]);
});

test('Manager cannot change their own rank or self-assign Discord Developer', async () => {
  for (const target of [getRole(admin), getRole(principal), getRole(discord), getRole(manager)]) {
    const user = makeMember(ids.manager, [manager, verified]);
    const { interaction, changes } = makeInteraction('add', ids.manager, target, null,
      new Map([[ids.manager, user]]));
    interaction.member.roles.cache = new Map([[manager, getRole(manager)]]);
    interaction.member.roles.highest = getRole(manager);
    const mode = target.id === manager ? 'remove' : 'add';
    const result = await executeRoleOperation(interaction, mode);
    assert.equal(user.calls.length, 0);
    if (Array.isArray(result?.success)) {
      assert.deepEqual(result.success, []);
      assert.match(result.records[0].error, /independent functional roles/);
    } else {
      assert.match(JSON.stringify(changes.at(-1)[1]), /role hierarchy/);
    }
  }
});

test('a regular member cannot modify their own role through the Manager exception', async () => {
  const user = makeMember(ids.manager, [moderator, verified]);
  const { interaction } = makeInteraction('add', ids.manager, getRole(artist), null,
    new Map([[ids.manager, user]]));
  interaction.member.roles.cache = new Map([[moderator, getRole(moderator)]]);
  interaction.member.roles.highest = getRole(moderator);
  const result = await executeRoleOperation(interaction, 'add');
  assert.deepEqual(result.success, []);
  assert.equal(user.calls.length, 0);
  assert.match(result.records[0].error, /Only Manager or Founder/);
});

test('Founder owner may change independent self-roles without breaking branch exemptions', async () => {
  const user = makeMember(ids.owner, [founder, principal, developer, admin, verified]);
  const { interaction } = makeInteraction('add', ids.owner, getRole(artist), null,
    new Map([[ids.owner, user]]));
  interaction.user.id = ids.owner;
  interaction.member.roles.cache = new Map([[founder, getRole(founder)]]);
  interaction.member.roles.highest = getRole(founder);
  const result = await executeRoleOperation(interaction, 'add');
  assert.deepEqual(result.success, [ids.owner]);
  same(user.member.roles.cache.keys(), [founder, principal, developer, admin, verified, artist]);
  assert.equal(user.calls.length, 1);
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
