import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const folder = mkdtempSync(join(tmpdir(), 'opus-ticket-scope-'));
process.env.DB_PATH = join(folder, 'ticket.sqlite');

const { config } = await import('../src/config.js');
const { execute, data } = await import('../src/commands/ticket.js');
const { db } = await import('../src/db.js');

const role = { id: '123456789012345681', name: 'Example Role', managed: false };
const user = { id: '123456789012345682', bot: false };
const actor = { id: '123456789012345683', tag: 'example' };

function makeInteraction({ sub = 'add', scope = null, targetRole = null, targetUser = null, manageServer = false, hidden = false } = {}) {
  const calls = [];
  const interaction = {
    guildId: config.guildId,
    channelId: '123456789012345684',
    user: actor,
    member: {
      roles: { cache: new Map() },
      permissions: { has: () => manageServer }
    },
    guild: {
      id: config.guildId,
      roles: { everyone: { id: config.guildId } }
    },
    options: {
      getSubcommand: () => sub,
      getUser: () => targetUser,
      getRole: () => targetRole,
      getString: name => name === 'scope' ? scope : null,
      getBoolean: name => name === 'hide' ? hidden : null
    },
    deferred: false,
    replied: false,
    async deferReply(payload) {
      calls.push({ type: 'defer', payload });
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push({ type: 'edit', payload });
      this.replied = true;
    },
    async reply(payload) {
      calls.push({ type: 'reply', payload });
      this.replied = true;
    }
  };
  return { interaction, calls };
}

test('ticket slash exposes only seven subcommands with explicit scope choice', () => {
  const options = data.toJSON().options;
  assert.deepEqual(options.map(option => option.name), [
    'open', 'status', 'add', 'remove', 'close', 'claim', 'rename'
  ]);
  for (const name of ['add', 'remove']) {
    const route = options.find(option => option.name === name);
    assert.deepEqual(route.options.map(option => option.name), ['user', 'role', 'scope']);
    const scope = route.options.find(option => option.name === 'scope');
    assert.deepEqual(scope.choices.map(choice => choice.value), ['ticket', 'all']);
    assert.equal(scope.required ?? false, false);
  }
});

test('default ticket scope never reaches permanent staff-role administration', async () => {
  for (const sub of ['add', 'remove']) {
    const { interaction, calls } = makeInteraction({ sub, targetRole: role });
    await execute(interaction, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'reply');
    assert.match(JSON.stringify(calls[0].payload), /not an open ticket/);
  }
});

test('explicit all-ticket scope for a role checks bot-controller authorization', async () => {
  for (const sub of ['add', 'remove']) {
    const { interaction, calls } = makeInteraction({ sub, scope: 'all', targetRole: role });
    await execute(interaction, {});
    assert.deepEqual(calls.map(call => call.type), ['defer', 'edit']);
    assert.equal(calls[0].payload.flags, 0);
    assert.match(JSON.stringify(calls[1].payload), /Manage Server authorization/);
  }
});

test('explicit all-ticket scope rejects individual users without making changes', async () => {
  for (const sub of ['add', 'remove']) {
    const { interaction, calls } = makeInteraction({ sub, scope: 'all', targetUser: user });
    await execute(interaction, {});
    assert.deepEqual(calls.map(call => call.type), ['reply']);
    assert.match(JSON.stringify(calls[0].payload), /requires a role/);
  }
});

test('all-ticket role changes still enforce managed-role restrictions', async () => {
  for (const sub of ['add', 'remove']) {
    const { interaction, calls } = makeInteraction({
      sub,
      scope: 'all',
      targetRole: { ...role, managed: true },
      manageServer: true,
      hidden: true
    });
    await execute(interaction, {});
    assert.deepEqual(calls.map(call => call.type), ['defer', 'edit']);
    assert.equal(calls[0].payload.flags, MessageFlags.Ephemeral);
    assert.match(JSON.stringify(calls[1].payload), /managed by an integration/);
  }
});

test('ticket-scoped access rejects user and role together', async () => {
  const { interaction, calls } = makeInteraction({
    scope: 'ticket',
    targetRole: role,
    targetUser: user
  });
  await execute(interaction, {});
  assert.deepEqual(calls.map(call => call.type), ['reply']);
  assert.match(JSON.stringify(calls[0].payload), /either a user or a role/);
});

test.after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
