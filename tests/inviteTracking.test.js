import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const folder = mkdtempSync(join(tmpdir(), 'opus-invite-track-'));
process.env.DB_PATH = join(folder, 'invites.sqlite');

const { db } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { beginInviteTracking, getInviteStats, getInviteTrackingSince, recordInviteJoin, recordInviteLeave } =
  await import('../src/services/inviteHistory.js');
const { InviteTracker, identifyInviteUse, snapshotInvites } = await import('../src/services/inviteTracker.js');
const { data, execute } = await import('../src/commands/invites.js');

const guildId = config.guildId;
const inviterId = '123456789012345670';
const otherInviter = '123456789012345671';
const userOne = '123456789012345672';
const userTwo = '123456789012345673';
const userThree = '123456789012345674';
const invite = (code, uses, inviter = inviterId) => ({
  code, uses, inviter: inviter ? { id: inviter } : null
});
const collection = (...invites) => new Map(invites.map(item => [item.code, item]));

test('first tracking timestamp is immutable after restarts', () => {
  assert.equal(beginInviteTracking(guildId, 1000), 1000);
  assert.equal(beginInviteTracking(guildId, 2000), 1000);
  assert.equal(getInviteTrackingSince(guildId), 1000);
});

test('snapshot comparison attributes only one unambiguous increment', () => {
  const old = snapshotInvites(collection(invite('abc', 2), invite('xyz', 4, otherInviter)));
  const next = snapshotInvites(collection(invite('abc', 3), invite('xyz', 4, otherInviter)));
  assert.deepEqual(identifyInviteUse(old, next), { code: 'abc', inviterId });
  assert.equal(identifyInviteUse(null, next), null);
  assert.equal(identifyInviteUse(old, snapshotInvites(collection(invite('abc', 4), invite('xyz', 4, otherInviter)))), null);
  assert.equal(identifyInviteUse(old, snapshotInvites(collection(invite('abc', 3), invite('xyz', 5, otherInviter)))), null);
  assert.equal(identifyInviteUse(old, snapshotInvites(collection(invite('abc', 2), invite('xyz', 4, otherInviter), invite('new', 1)))), null);
  const unknownBefore = snapshotInvites(collection(invite('abc', 2, null), invite('xyz', 4)));
  assert.equal(identifyInviteUse(unknownBefore, snapshotInvites(collection(invite('abc', 3, null), invite('xyz', 4)))), null);
});

test('only unique tracked members count, even when they rejoin through another invite', () => {
  const first = recordInviteJoin({ guildId, userId: userOne, inviterId, inviteCode: 'abc', at: 1100 });
  assert.equal(first.inviter_id, inviterId);
  recordInviteJoin({ guildId, userId: userOne, inviterId, inviteCode: 'abc', at: 1100 });
  assert.equal(getInviteStats(guildId, inviterId).total, 1);
  assert.equal(recordInviteLeave(guildId, userOne, 1300), true);
  assert.deepEqual(
    (({ total, present, left }) => ({ total, present, left }))(getInviteStats(guildId, inviterId)),
    { total: 1, present: 0, left: 1 }
  );
  recordInviteJoin({ guildId, userId: userOne, inviterId: otherInviter, inviteCode: 'xyz', at: 1400 });
  assert.equal(getInviteStats(guildId, inviterId).total, 1);
  assert.equal(getInviteStats(guildId, inviterId).present, 1);
  assert.equal(getInviteStats(guildId, otherInviter).total, 0);
  const historical = db.prepare("SELECT inviter_id,invite_code,joined_at,last_join_at FROM invite_join_history WHERE guild_id=? AND user_id=?").get(guildId, userOne);
  assert.equal(historical.inviter_id, inviterId);
  assert.equal(historical.invite_code, 'abc');
  assert.equal(historical.joined_at, 1100);
  assert.equal(historical.last_join_at, 1400);
});

test('unknown sources and self invitations are excluded from confirmed inviter totals', () => {
  recordInviteJoin({ guildId, userId: userTwo, at: 1500 });
  recordInviteJoin({ guildId, userId: userThree, inviterId: userThree, at: 1500 });
  assert.equal(getInviteStats(guildId, inviterId).total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invite_join_history WHERE inviter_id IS NULL").get().count, 2);
});

test('tracker initializes existing links without treating prior uses as new joins', async () => {
  let state = collection(invite('abc', 4), invite('xyz', 2, otherInviter));
  const tracker = new InviteTracker();
  const guild = { id: guildId, invites: { fetch: async () => state } };
  assert.equal(await tracker.initialize(guild), 2);
  state = collection(invite('abc', 5), invite('xyz', 2, otherInviter));
  const result = await tracker.onJoin({ guild, id: '123456789012345675', user: { bot: false } });
  assert.equal(result.inviter_id, inviterId);
  assert.equal(result.invite_code, 'abc');
  assert.equal(getInviteStats(guildId, inviterId).total, 2);
  assert.equal(tracker.onLeave({ guild, id: '123456789012345675', user: { bot: false } }), true);
  assert.equal(getInviteStats(guildId, inviterId).left, 1);
});

test('ambiguous concurrent increments are left unattributed', async () => {
  let state = collection(invite('aaa', 0), invite('bbb', 0, otherInviter));
  const tracker = new InviteTracker();
  const guild = { id: guildId, invites: { fetch: async () => state } };
  await tracker.initialize(guild);
  state = collection(invite('aaa', 1), invite('bbb', 1, otherInviter));
  const row = await tracker.onJoin({ guild, id: '123456789012345676', user: { bot: false } });
  assert.equal(row.inviter_id, null);
  assert.equal(getInviteStats(guildId, inviterId).total, 2);
});

test('sequential concurrent joins are serialized without a double attribution', async () => {
  let requests = 0;
  const tracker = new InviteTracker({
    begin: () => null,
    join: input => input,
    leave: () => true
  });
  const guild = {
    id: guildId,
    invites: {
      fetch: async () => {
        const uses = requests++;
        return collection(invite('abc', uses));
      }
    }
  };
  await tracker.initialize(guild);
  const [first, second] = await Promise.all([
    tracker.onJoin({ guild, id: '123456789012345677', user: { bot: false } }),
    tracker.onJoin({ guild, id: '123456789012345678', user: { bot: false } })
  ]);
  assert.equal(first.inviterId, inviterId);
  assert.equal(second.inviterId, inviterId);
  assert.equal(requests, 3);
});

test('create/delete notifications preserve snapshots without fabricating attribution', async () => {
  let state = collection(invite('abc', 0));
  const tracker = new InviteTracker({ join: input => input });
  const guild = { id: guildId, invites: { fetch: async () => state } };
  await tracker.initialize(guild);
  tracker.onCreate({ guild, code: 'new', inviter: { id: otherInviter }, uses: 0 });
  assert.equal(tracker.snapshots.get(guildId).has('new'), true);
  tracker.onDelete({ guild, code: 'new' });
  assert.equal(tracker.snapshots.get(guildId).has('new'), false);
  state = collection(invite('abc', 0));
  const joined = await tracker.onJoin({ guild, id: '123456789012345679', user: { bot: false } });
  assert.equal(joined.inviterId, null);
  assert.equal(await tracker.onJoin({ guild, id: '123456789012345690', user: { bot: true } }), null);
});

test('/invites is public by default, hides on request, and does not reveal invite codes', async () => {
  const user = {
    id: inviterId, username: 'example',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
  };
  const interactions = [];
  const mock = hidden => ({
    guildId,
    user,
    options: { getUser: () => user, getBoolean: () => hidden },
    guild: {
      invites: {
        fetch: async () => collection(invite('SECRET-CODE', 20), invite('xyz', 3, otherInviter))
      }
    },
    deferReply: async data => interactions.push(['defer', data]),
    editReply: async data => interactions.push(['edit', data])
  });
  assert.equal(data.toJSON().name, 'invites');
  await execute(mock(false));
  assert.equal(interactions[0][1].flags, 0);
  const publicEmbed = JSON.stringify(interactions[1][1].embeds[0].toJSON());
  assert.match(publicEmbed, /20 historical use/);
  assert.match(publicEmbed, /Members Invited/);
  assert.doesNotMatch(publicEmbed, /SECRET-CODE/);
  interactions.length = 0;
  await execute(mock(true));
  assert.equal(interactions[0][1].flags, MessageFlags.Ephemeral);
});

test.after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
