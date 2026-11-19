import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const folder = mkdtempSync(join(tmpdir(), 'opus-info-'));
process.env.DB_PATH = join(folder, 'member-info.sqlite');

const { db } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { recordTeamRoleChange, getTeamRoleHistory } = await import('../src/services/teamRoleHistory.js');
const { buildMemberProfile } = await import('../src/services/memberProfile.js');
const { data, execute } = await import('../src/commands/info.js');

const userId = '123456789012345678';
const actorId = '123456789012345677';
const ownerId = '123456789012345676';
const firstRole = { id: config.roleBranches.staff[3], name: 'Moderator', position: 12, color: 0 };
const secondRole = { id: config.roleBranches.staff[2], name: 'Adminstrator', position: 13, color: 0 };
const developer = { id: config.roleBranches.developer, name: 'Developer', position: 18, color: 0x6382A8 };

const profileMember = {
  id: userId,
  displayName: 'Test Developer',
  joinedTimestamp: Date.UTC(2026, 6, 1),
  displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123456789012345678/demo.png',
  user: {
    id: userId,
    username: 'test_developer',
    createdTimestamp: Date.UTC(2025, 3, 10),
    bot: false
  },
  roles: {
    cache: new Map([firstRole, developer].map(role => [role.id, role]))
  }
};

const guild = {
  id: config.guildId,
  ownerId,
  name: 'Opus Client',
  members: {
    fetch: async options => options.user === userId ? profileMember : null
  }
};

test('history records successful promote and demote with event IDs and reasons', () => {
  const before = getTeamRoleHistory(config.guildId, userId);
  assert.equal(before.total, 0);
  const first = recordTeamRoleChange({
    guildId: config.guildId,
    userId, moderatorId: actorId, mode: 'promote',
    fromRole: firstRole, toRole: secondRole,
    removedRoles: [firstRole],
    addedRoles: [secondRole],
    branch: 'staff',
    reason: 'Internal promotion',
    interactionId: '123456789012345680',
    createdAt: Date.UTC(2026, 10, 17)
  });
  assert.equal(first.mode, 'promote');
  recordTeamRoleChange({
    guildId: config.guildId,
    userId, moderatorId: actorId, mode: 'promote',
    fromRole: firstRole, toRole: secondRole,
    removedRoles: [firstRole], addedRoles: [secondRole],
    branch: 'staff', interactionId: '123456789012345680'
  });
  const second = recordTeamRoleChange({
    guildId: config.guildId,
    userId, moderatorId: actorId,
    mode: 'demote', fromRole: secondRole,
    toRole: firstRole, removedRoles: [secondRole],
    branch: 'staff', interactionId: '123456789012345681',
    createdAt: Date.UTC(2026, 10, 19)
  });
  assert.equal(second.mode, 'demote');
  const history = getTeamRoleHistory(config.guildId, userId);
  assert.equal(history.total, 2);
  assert.deepEqual(history.rows.map(row => row.mode), ['demote', 'promote']);
  assert.equal(history.rows[1].reason, 'Internal promotion');
  assert.deepEqual(history.rows[1].removedRoles, [{ id: firstRole.id, name: firstRole.name }]);
  assert.equal(getTeamRoleHistory(config.guildId, '123456789012345679').total, 0);
});

test('member profile displays avatar, join date, positions and real history', () => {
  const history = getTeamRoleHistory(config.guildId, userId);
  const embed = buildMemberProfile({ member: profileMember, guild, history }).toJSON();
  assert.match(embed.author.name, /Test Developer/);
  assert.match(embed.thumbnail.url, /demo.png/);
  assert.match(embed.description, /test.*developer/);
  const joined = embed.fields.find(field => field.name === 'Joined Opus Client');
  assert.match(joined.value, /<t:\d+:F>/);
  assert.ok(embed.fields.some(field => field.name === 'Current Positions' && field.value.includes('Moderator') === false && field.value.includes(firstRole.id)));
  assert.ok(embed.fields.some(field => field.name === 'Discord Account Created'));
  assert.ok(embed.fields.some(field => field.name === 'Role History' && field.value.includes('2')));
  assert.ok(embed.fields.some(field => field.name.includes('Promotion')));
  assert.ok(embed.fields.some(field => field.name.includes('Demotion')));
  assert.doesNotMatch(JSON.stringify(embed), /Internal promotion/);
  const privateEmbed = buildMemberProfile({ member: profileMember, guild, history, showReasons: true }).toJSON();
  assert.match(JSON.stringify(privateEmbed), /Internal promotion/);
  assert.ok(privateEmbed.fields.every(field => field.value.length <= 1024));
});

test('/info uses an optional user and inherits public visibility by default', () => {
  const schema = data.toJSON();
  assert.equal(schema.name, 'info');
  assert.equal(schema.options.length, 1);
  assert.equal(schema.options[0].name, 'user');
  assert.equal(schema.options[0].required, false);
});

test('info command retrieves selected user profile and respects hide', async () => {
  const replies = [];
  const interaction = {
    guildId: config.guildId, guild,
    user: { id: actorId },
    member: { roles: { cache: new Map() }, permissions: { has: () => false } },
    options: {
      getUser: name => name === 'user' ? profileMember.user : null,
      getBoolean: () => null
    },
    deferReply: async value => replies.push(['defer', value]),
    editReply: async value => replies.push(['edit', value])
  };
  await execute(interaction);
  assert.equal(replies[0][1].flags, 0);
  assert.match(replies[1][1].embeds[0].toJSON().description, /test.*developer/);
  assert.deepEqual(replies[1][1].allowedMentions, { parse: [] });
  replies.length = 0;
  interaction.options.getBoolean = () => true;
  await execute(interaction);
  assert.equal(replies[0][1].flags, MessageFlags.Ephemeral);
  assert.doesNotMatch(JSON.stringify(replies[1][1]), /Internal promotion/);
});

test('info returns a clear error for a user outside the guild', async () => {
  const responses = [];
  const interaction = {
    guildId: config.guildId, guild,
    user: { id: '123456789012345699' },
    options: {
      getUser: () => null,
      getBoolean: () => null
    },
    deferReply: async data => responses.push(data),
    editReply: async data => responses.push(data)
  };
  await execute(interaction);
  assert.match(JSON.stringify(responses.at(-1)), /not currently a member/);
});

test.after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
