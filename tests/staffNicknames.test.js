import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const { roleNicknamePrefix, formatRoleNickname, calculateRoleNickname } = await import('../src/services/nicknamePolicy.js');
const { syncStaffNickname, reconcileStaffNicknames } = await import('../src/services/staffNicknames.js');

assert.equal(config.nicknames.enabled, false);
config.nicknames.enabled = true;

const roleByPrefix = Object.fromEntries(config.nicknames.rolePrefixes.map(r => [r.prefix, r.roleId]));
let counter = 0;

function sample(prefixes, { nickname = null, globalName = 'display name', manageable = true, owner = false } = {}) {
  const id = String(6000000000000000000n + BigInt(++counter));
  const assigned = new Set(prefixes.map(p => roleByPrefix[p]));
  const changes = [];
  const member = {
    id,
    user: { bot: false, globalName, username: 'username' },
    guild: { id: config.guildId, ownerId: owner ? id : '1320303839701897230' },
    roles: { cache: { has: x => assigned.has(x) } },
    nickname,
    manageable,
    setNickname: async next => { changes.push(next); member.nickname = next; }
  };
  return { member, assigned, changes };
}

test('role priority follows Owner, Manager, Dev, Admin, Mod, Support, Artist, Tester, Creator', () => {
  for (const [roles, expected] of [
    [['Creator'], 'Creator'],
    [['Tester'], 'Tester'],
    [['Artist'], 'Artist'],
    [['Creator', 'Tester'], 'Tester'],
    [['Creator', 'Artist'], 'Artist'],
    [['Creator', 'Dev'], 'Dev'],
    [['Tester', 'Dev'], 'Dev'],
    [['Artist', 'Support'], 'Support'],
    [['Artist', 'Dev'], 'Dev'],
    [['Admin', 'Manager'], 'Manager'],
    [['Dev', 'Owner'], 'Owner'],
    [['Mod', 'Admin'], 'Admin']
  ]) {
    const { member } = sample(roles);
    assert.equal(roleNicknamePrefix(member, config.nicknames), expected);
  }
});

test('custom guild nickname is kept after the role prefix and restored on removal', async () => {
  const { member, assigned, changes } = sample(['Artist'], { nickname: 'maii' });
  assert.equal((await syncStaffNickname(member)).status, 'updated');
  assert.equal(member.nickname, '[Artist] maii');
  assert.equal((await syncStaffNickname(member)).status, 'unchanged');
  assigned.clear();
  assert.equal((await syncStaffNickname(member)).status, 'restored');
  assert.equal(member.nickname, 'maii');
  assert.deepEqual(changes, ['[Artist] maii', 'maii']);
});

test('a user with Artist and Dev gets only Dev; changing roles updates one prefix', async () => {
  const { member, assigned } = sample(['Artist', 'Dev'], { nickname: 'sleep 💤' });
  await syncStaffNickname(member);
  assert.equal(member.nickname, '[Dev] sleep 💤');
  assigned.delete(roleByPrefix.Dev);
  await syncStaffNickname(member);
  assert.equal(member.nickname, '[Artist] sleep 💤');
  assigned.clear();
  await syncStaffNickname(member);
  assert.equal(member.nickname, 'sleep 💤');
});

test('member can change their preferred nickname while prefixed', async () => {
  const { member, assigned } = sample(['Artist'], { nickname: 'maii' });
  await syncStaffNickname(member);
  member.nickname = 'new custom name';
  await syncStaffNickname(member);
  assert.equal(member.nickname, '[Artist] new custom name');
  assigned.clear();
  await syncStaffNickname(member);
  assert.equal(member.nickname, 'new custom name');
});

test('without an original nickname a removed role restores no guild nickname', async () => {
  const { member, assigned } = sample(['Support'], { nickname: null, globalName: 'my display' });
  await syncStaffNickname(member);
  assert.equal(member.nickname, '[Support] my display');
  member.user.globalName = 'other display';
  await syncStaffNickname(member);
  assert.equal(member.nickname, '[Support] other display');
  assigned.clear();
  await syncStaffNickname(member);
  assert.equal(member.nickname, null);
});

test('owner and role hierarchy are respected without persisting a false success', async () => {
  const owner = sample(['Owner'], { owner: true });
  assert.deepEqual(await syncStaffNickname(owner.member), {
    status: 'blocked', reason: 'guild-owner', desired: '[Owner] display name'
  });
  const unreachable = sample(['Dev'], { manageable: false });
  assert.equal((await syncStaffNickname(unreachable.member)).reason, 'role-hierarchy');
});

test('nickname prefix formatting respects 32 codepoints and strips legacy prefixes', () => {
  const name = formatRoleNickname('Manager', '[Dev] [Artist] ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk');
  assert.equal(Array.from(name).length, 32);
  assert.equal(name.startsWith('[Manager] ABC'), true);
  const { member } = sample(['Manager'], { globalName: 'hello' });
  assert.equal(calculateRoleNickname(member, config.nicknames, 'custom'), '[Manager] custom');
});

test('unmanaged users remain unchanged and bot accounts are ignored', async () => {
  const member = sample([], { nickname: 'hello' });
  assert.equal((await syncStaffNickname(member.member)).status, 'unchanged');
  const robot = sample(['Artist']);
  robot.member.user.bot = true;
  assert.equal((await syncStaffNickname(robot.member)).status, 'ignored');
});

test('startup reconciliation skips unassigned users and does not duplicate prefixes', async () => {
  const artist = sample(['Artist'], { nickname: 'mai' });
  const regular = sample([], { nickname: 'user' });
  const guild = {
    id: config.guildId,
    members: { list: async () => new Map([[artist.member.id, artist.member], [regular.member.id, regular.member]]) }
  };
  const first = await reconcileStaffNicknames(guild);
  const second = await reconcileStaffNicknames(guild);
  assert.equal(first.updated, 1);
  assert.equal(second.updated, 0);
  assert.equal(artist.member.nickname, '[Artist] mai');
});

test('Creator and Tester use the configured prefix, keep nicknames and restore the original', async () => {
  const creator = sample(['Creator'], { nickname: 'video maker' });
  assert.equal((await syncStaffNickname(creator.member)).status, 'updated');
  assert.equal(creator.member.nickname, '[Creator] video maker');
  creator.assigned.clear();
  assert.equal((await syncStaffNickname(creator.member)).status, 'restored');
  assert.equal(creator.member.nickname, 'video maker');

  const tester = sample(['Tester'], { nickname: 'tester name' });
  assert.equal((await syncStaffNickname(tester.member)).status, 'updated');
  assert.equal(tester.member.nickname, '[Tester] tester name');
  assert.equal((await syncStaffNickname(tester.member)).status, 'unchanged');
  tester.assigned.clear();
  assert.equal((await syncStaffNickname(tester.member)).status, 'restored');
  assert.equal(tester.member.nickname, 'tester name');
});

test('a member with Artist, Tester and Creator displays only Artist', async () => {
  const contributor = sample(['Artist', 'Tester', 'Creator'], { nickname: 'maii' });
  await syncStaffNickname(contributor.member);
  assert.equal(contributor.member.nickname, '[Artist] maii');
  contributor.assigned.delete(roleByPrefix.Artist);
  await syncStaffNickname(contributor.member);
  assert.equal(contributor.member.nickname, '[Tester] maii');
  contributor.assigned.delete(roleByPrefix.Tester);
  await syncStaffNickname(contributor.member);
  assert.equal(contributor.member.nickname, '[Creator] maii');
});


test('disabled policy never adds or restores a prefix', async () => {
  config.nicknames.enabled = false;
  try {
    const { member, changes } = sample(['Dev'], { nickname: 'plain name' });
    assert.equal((await syncStaffNickname(member)).status, 'ignored');
    assert.equal(member.nickname, 'plain name');
    assert.deepEqual(changes, []);
    assert.equal(roleNicknamePrefix(member, config.nicknames), null);
  } finally {
    config.nicknames.enabled = true;
  }
});
