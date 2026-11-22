import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collection, ChannelType, AuditLogEvent } from 'discord.js';

const dir = mkdtempSync(path.join(tmpdir(), 'opus-authority-integrity-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.OPUS_AUTHORITY_MODE = 'enforce';

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const {
  withAuthorizedRoleMutation,
  initializeAuthorityIntegrity,
  evaluateMemberRoleUpdate,
  authorityDecisionStore,
  acceptCurrentAuthorityBaseline,
  reviewAuthorityInteraction,
  notifyFounderOfManagerDecision,
  isMemberUnderAuthorityReview
} = await import('../src/services/roleIntegrity.js');

const everyone = config.guildId;
const verified = config.verifiedRoleId;
const developer = config.roleBranches.developer;
const human = '444444444444444444';
const manager = '555555555555555555';
const bot = '666666666666666666';
const owner = '777777777777777777';

function fixture(initial = [verified], auditExecutor = manager) {
  const messages = [];
  const dms = [];
  const roles = new Collection();
  const guild = {
    id: config.guildId,
    ownerId: owner,
    name: 'Opus Client',
    roles: {
      cache: roles,
      fetch: async id => id ? roles.get(id) ?? null : roles
    },
    channels: {
      cache: new Collection(),
      fetch: async () => null,
      create: async input => {
        const channel = {
          id: '123456789012345679',
          name: input.name,
          type: ChannelType.GuildText,
          isTextBased: () => true,
          send: async payload => { messages.push(payload); }
        };
        guild.channels.cache.set(channel.id, channel);
        return channel;
      }
    },
    client: {
      user: { id: bot },
      users: { fetch: async id => ({ send: async payload => { dms.push({ id, payload }); } }) }
    }
  };
  const role = id => {
    const item = {
      id,
      guild,
      managed: false,
      position: id === developer ? 8 : 4,
      name: id === developer ? 'Developer' : 'Verified',
      permissions: { bitfield: 0n },
      color: 0,
      hoist: false,
      mentionable: false
    };
    roles.set(id, item);
  };
  role(verified);
  role(developer);
  let member;
  const roleId = input => String(input?.id ?? input);
  member = {
    id: human,
    guild,
    user: { bot: false },
    roles: {
      cache: new Collection(initial.map(id => [id, roles.get(id)])),
      add: async input => {
        for (const r of (Array.isArray(input) ? input : [input])) member.roles.cache.set(roleId(r), roles.get(roleId(r)));
      },
      remove: async input => {
        for (const r of (Array.isArray(input) ? input : [input])) member.roles.cache.delete(roleId(r));
      },
      set: async inputs => {
        member.roles.cache.clear();
        for (const r of inputs) member.roles.cache.set(roleId(r), roles.get(roleId(r)));
      }
    }
  };
  guild.members = {
    me: { id: bot, roles: { highest: { position: 25 } } },
    cache: new Collection([[human, member]]),
    fetch: async args => !args ? guild.members.cache : member
  };
  guild.fetchAuditLogs = async () => ({
    entries: new Collection([['audit-a', {
      id: 'audit-a',
      targetId: human,
      executorId: auditExecutor,
      createdTimestamp: Date.now(),
      action: AuditLogEvent.MemberRoleUpdate,
      changes: [{ key: '$add', new: [{ id: developer }] }]
    }]])
  });
  return { guild, member, messages, dms };
}

test('Bot authorization creates confirmed intent and trusted member snapshot', async () => {
  const { guild, member } = fixture();
  await initializeAuthorityIntegrity(guild);
  await withAuthorizedRoleMutation(member, {
    action: 'add', roles: developer, reason: 'Authorized development assignment', actorId: owner
  });
  const row = db.prepare('SELECT roles_json FROM authority_member_snapshots WHERE guild_id=? AND member_id=?').get(guild.id, human);
  assert.deepEqual(JSON.parse(row.roles_json), [developer, verified].sort());
  const tx = db.prepare('SELECT * FROM authority_member_intents ORDER BY created_at DESC LIMIT 1').get();
  assert.equal(tx.status, 'confirmed');
  assert.equal(tx.actor_id, owner);
  assert.equal(isMemberUnderAuthorityReview(guild.id, human), false);
});

test('Unrecorded Developer assignment is restored from trusted state', async () => {
  const { guild, member, messages } = fixture([verified, developer]);
  await initializeAuthorityIntegrity(guild);
  await withAuthorizedRoleMutation(member, {
    action: 'remove', roles: developer, reason: 'Reset test member to verified', actorId: owner
  });
  await member.roles.add(developer);
  await evaluateMemberRoleUpdate(null, member);
  assert.equal(member.roles.cache.has(developer), false);
  const last = db.prepare("SELECT * FROM authority_incidents WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 1").get(guild.id, human);
  assert.equal(last.status, 'restored');
  assert.equal(last.restoration_actor_id, bot);
  assert.ok(messages.length >= 1);
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Monitor mode records unauthorized role changes without automatic rollback', async () => {
  const previousMode = process.env.OPUS_AUTHORITY_MODE;
  process.env.OPUS_AUTHORITY_MODE = 'monitor';
  try {
    const { guild, member, messages } = fixture();
    await initializeAuthorityIntegrity(guild);
    await member.roles.add(developer);
    await evaluateMemberRoleUpdate(null, member);
    assert.equal(member.roles.cache.has(developer), true);
    const latest = db.prepare("SELECT * FROM authority_incidents WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 1").get(guild.id, human);
    assert.equal(latest.status, 'pending');
    assert.ok(messages.length >= 1);
  } finally {
    process.env.OPUS_AUTHORITY_MODE = previousMode;
  }
});

test('Owner accepts all historical drift silently and creates an exact new baseline', async () => {
  const { guild, member, messages } = fixture([verified, developer]);
  const incident = authorityDecisionStore.open({
    guildId: guild.id,
    incidentKey: 'historic-silent-cutover',
    level: 3,
    targetId: member.id,
    beforeRoles: [verified],
    afterRoles: [verified, developer],
    context: { source: 'startup' }
  });
  const result = acceptCurrentAuthorityBaseline(guild, { epochKey: 'test-silent-cutover' });
  assert.equal(result.alreadyAccepted, false);
  assert.ok(result.incidents >= 1);
  assert.equal(authorityDecisionStore.get(incident.id).status, 'accepted_baseline');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM authority_incidents WHERE guild_id=? AND status='pending'").get(guild.id).count, 0);
  assert.deepEqual(JSON.parse(db.prepare('SELECT roles_json FROM authority_member_snapshots WHERE guild_id=? AND member_id=?').get(guild.id, member.id).roles_json), [developer, verified].sort());
  assert.equal(messages.length, 0);
  assert.equal(authorityDecisionStore.verifyJournal(guild.id), true);
  const second = acceptCurrentAuthorityBaseline(guild, { epochKey: 'test-silent-cutover' });
  assert.equal(second.alreadyAccepted, true);
});

test('Founder direct role changes are monitored without DM or role pings', async () => {
  const previousMode = process.env.OPUS_AUTHORITY_MODE;
  process.env.OPUS_AUTHORITY_MODE = 'monitor';
  try {
    const { guild, member, messages, dms } = fixture([verified], owner);
    acceptCurrentAuthorityBaseline(guild, { epochKey: 'founder-action-fixture' });
    await initializeAuthorityIntegrity(guild);
    await member.roles.add(developer);
    await evaluateMemberRoleUpdate(null, member);
    const incident = db.prepare("SELECT * FROM authority_incidents WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 1").get(guild.id, member.id);
    assert.equal(incident.executor_id, owner);
    assert.equal(incident.status, 'pending');
    const msg = messages.at(-1);
    assert.ok(msg);
    assert.deepEqual(msg.allowedMentions, { parse: [] });
    assert.match(msg.embeds[0].data.description, new RegExp(owner));
    assert.equal(dms.length, 0);
  } finally {
    process.env.OPUS_AUTHORITY_MODE = previousMode;
  }
});

test('Only confirmed Manager decisions notify Founder by DM, with no mentions', async () => {
  const { guild, dms } = fixture();
  const incident = { id: 1001, level: 3, target_id: human };
  const managerInteraction = {
    user: { id: manager },
    guild,
    member: { roles: { cache: new Map([[config.roleBranches.manager, {}]]) } },
    client: guild.client
  };
  const founderInteraction = {
    ...managerInteraction,
    user: { id: owner }
  };
  assert.equal(await notifyFounderOfManagerDecision(managerInteraction, incident, { status: 'kept_manager' }, 'keep'), true);
  assert.equal(await notifyFounderOfManagerDecision(managerInteraction, incident, { status: 'restored' }, 'restore'), true);
  assert.equal(await notifyFounderOfManagerDecision(founderInteraction, incident, { status: 'kept_founder' }, 'keep'), false);
  assert.equal(await notifyFounderOfManagerDecision(founderInteraction, incident, { status: 'founder_revoked' }, 'restore'), false);
  assert.equal(dms.length, 2);
  assert.ok(dms.every(item => item.id === owner));
  assert.ok(dms.every(item => item.payload.allowedMentions.parse.length === 0));
});

test('Manager Keep notifies Founder; later Founder veto does not notify Manager', async () => {
  const oldMode = process.env.OPUS_AUTHORITY_MODE;
  process.env.OPUS_AUTHORITY_MODE = 'monitor';
  try {
    const { guild, member, dms, messages } = fixture([verified], owner);
    acceptCurrentAuthorityBaseline(guild, { epochKey: 'manager-confirmation-fixture' });
    await initializeAuthorityIntegrity(guild);
    await member.roles.add(developer);
    await evaluateMemberRoleUpdate(null, member);
    const pending = db.prepare("SELECT * FROM authority_incidents WHERE guild_id=? AND target_id=? AND status='pending' ORDER BY id DESC LIMIT 1").get(guild.id, member.id);
    assert.ok(pending);
    const makeInteraction = (id, action) => ({
      isButton: () => true,
      customId: 'oai:' + action + ':' + pending.id,
      guildId: guild.id,
      guild,
      user: { id },
      client: guild.client,
      member: { roles: { cache: new Map(id === manager ? [[config.roleBranches.manager, {}]] : []) } },
      deferReply: async () => {},
      editReply: async () => {}
    });
    assert.equal(await reviewAuthorityInteraction(makeInteraction(manager, 'keep')), true);
    assert.equal(authorityDecisionStore.get(pending.id).status, 'kept_manager');
    assert.equal(dms.length, 1);
    assert.equal(dms[0].id, owner);
    assert.equal(await reviewAuthorityInteraction(makeInteraction(owner, 'restore')), true);
    assert.equal(authorityDecisionStore.get(pending.id).status, 'founder_revoked');
    assert.equal(dms.length, 1);
    assert.ok(messages.every(item => JSON.stringify(item.allowedMentions) === '{"parse":[]}'));
  } finally {
    process.env.OPUS_AUTHORITY_MODE = oldMode;
  }
});
