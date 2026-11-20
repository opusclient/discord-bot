import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MessageFlags } from 'discord.js';

const testDir = mkdtempSync(path.join(tmpdir(), 'opus-slash-test-'));
process.env.DB_PATH = path.join(testDir, 'slash.sqlite');

const { config } = await import('../src/config.js');
const { loadCommands } = await import('../src/utils/loaders.js');
const { validateModuleCatalog } = await import('../src/modules/registry.js');
const expectedCount = validateModuleCatalog().commandCount;
const { commandDifferences, registriesMatch, syncGuildSlashCommands } = await import('../src/services/slashSync.js');
const { TYPE_META } = await import('../src/constants.js');
const { db, createCase, listCases } = await import('../src/db.js');

const commands = await loadCommands(path.resolve('src/commands'), new Map());
const definitions = [...commands.values()].map(command => command.data.toJSON());
const toCollection = rows => new Map(rows.map(row => [row.name, { toJSON: () => row }]));

test('all operational slash commands have handlers and valid definitions', () => {
  assert.equal(commands.size, expectedCount);
  for (const name of ['ticket', 'help', 'info', 'invites', 'claim', 'unclaim', 'punishments', 'warning', 'blacklist', 'role', 'promote', 'demote', 'install', 'setup', 'mute', 'ban']) {
    assert.ok(commands.has(name));
    assert.equal(typeof commands.get(name).execute, 'function');
  }
  for (const name of ['add', 'remove', 'close', 'rename', 'ticketroleadd', 'ticketroleremove', 'warn', 'warnings', 'history', 'case', 'overlay', 'addrole', 'removerole']) {
    assert.ok(!commands.has(name));
  }
  assert.equal(new Set(definitions.map(x => x.name)).size, definitions.length);
  for (const definition of definitions) {
    assert.ok(definition.name);
    assert.ok(definition.description);
    assert.ok(definition.description.length <= 100);
    for (const option of definition.options ?? []) {
      assert.ok(option.name);
      assert.ok(option.description);
      assert.ok(option.description.length <= 100);
    }
  }
});

test('ticket, warning, blacklist and punishments expose the requested options', () => {
  const ticket = commands.get('ticket').data.toJSON();
  assert.deepEqual(ticket.options.map(x => x.name), ['open', 'status', 'add', 'remove', 'close', 'claim', 'rename']);
  assert.deepEqual(ticket.options[0].options.map(x => x.name), ['hide']);
  for (const name of ['add', 'remove']) {
    assert.deepEqual(ticket.options.find(x => x.name === name).options.map(x => x.name), ['user', 'role', 'scope', 'hide']);
    assert.deepEqual(ticket.options.find(x => x.name === name).options.find(x => x.name === 'scope').choices.map(x => x.value), ['ticket', 'all']);
  }
  assert.equal(ticket.options.find(x => x.name === 'close').options[0].name, 'reason');
  const warning = commands.get('warning').data.toJSON();
  assert.deepEqual(warning.options.map(x => x.name), ['user', 'reason', 'hide']);
  assert.ok(warning.options.filter(x => x.name !== 'hide').every(x => x.required));
  assert.equal(warning.options.at(-1).required, false);
  const blacklist = commands.get('blacklist').data.toJSON();
  assert.deepEqual(blacklist.options.map(x => x.name), ['user', 'reason', 'hide']);
  const punishments = commands.get('punishments').data.toJSON();
  assert.deepEqual(punishments.options.map(x => x.name), ['view', 'clear']);
  const viewTypes = punishments.options[0].options.find(x => x.name === 'type').choices.map(x => x.value);
  assert.ok(viewTypes.includes('warn'));
  assert.ok(viewTypes.includes('blacklisted'));
  const clear = punishments.options[1];
  assert.deepEqual(clear.options.map(x => x.name), ['caseid', 'type', 'reason', 'hide']);
  assert.equal(clear.options[0].required, true);
  assert.deepEqual(clear.options[1].choices.map(x => x.value), ['warn', 'mute', 'ban', 'blacklisted']);
});

test('command comparison detects missing, outdated and stale registrations', () => {
  const modified = definitions.map(x => x.name === 'help' ? { ...x, description: 'Old help menu' } : x).filter(x => x.name !== 'ticket');
  modified.push({ name: 'legacy', description: 'Obsolete', options: [] });
  const result = commandDifferences(modified, definitions);
  assert.deepEqual(result.missing, ['ticket']);
  assert.deepEqual(result.outdated, ['help']);
  assert.deepEqual(result.extra, ['legacy']);
  assert.equal(registriesMatch(result), false);
  assert.equal(registriesMatch(commandDifferences(definitions, definitions)), true);
});

test('startup sync changes only out-of-date guild commands and re-verifies', async () => {
  let data = definitions.filter(x => x.name !== 'help');
  let changes = 0;
  const guild = {
    commands: {
      fetch: async () => toCollection(data),
      set: async body => {
        data = body;
        changes += 1;
        return toCollection(data);
      }
    }
  };
  const client = { guilds: { cache: new Map([[config.guildId, guild]]) }, commands };
  const first = await syncGuildSlashCommands(client);
  assert.equal(first.changed, true);
  assert.equal(first.count, expectedCount);
  assert.equal(changes, 1);
  const second = await syncGuildSlashCommands(client);
  assert.equal(second.changed, false);
  assert.equal(changes, 1);
});

test('ticket slash open displays a clean embed category panel', async () => {
  const { execute } = commands.get('ticket');
  let reply = null;
  const interaction = {
    guildId: config.guildId,
    guild: { iconURL: () => null },
    options: { getSubcommand: () => 'open' },
    reply: async payload => { reply = payload; }
  };
  await execute(interaction, { user: { displayAvatarURL: () => null } });
  assert.equal(reply.embeds.length, 2);
  assert.equal(reply.components.length, 2);
  assert.equal(reply.flags & MessageFlags.IsComponentsV2, 0);
  assert.equal(reply.flags & MessageFlags.Ephemeral, 0);
  const rows = reply.components.map(item => item.toJSON());
  assert.equal(rows[0].components[0].options.length, 9);
  assert.deepEqual(rows[1].components.map(item => item.custom_id), [
    'ticket_panel_my', 'ticket_panel_status', 'ticket_panel_guide'
  ]);
});

test('all warnings and blacklist cases are visible in the shared history', () => {
  const guildId = '123456789012345678';
  const userId = '123456789012345679';
  const moderatorId = '123456789012345680';
  createCase({ guildId, userId, moderatorId, type: 'warn', reason: 'warning reason' });
  createCase({ guildId, userId, moderatorId, type: 'blacklisted', reason: 'blacklist reason' });
  const all = listCases({ guildId, userId, type: 'all' });
  assert.deepEqual(all.rows.map(x => x.type), ['blacklisted', 'warn']);
  assert.equal(listCases({ guildId, userId, type: 'warn' }).total, 1);
  assert.equal(listCases({ guildId, userId, type: 'blacklisted' }).total, 1);
  assert.equal(TYPE_META.blacklisted.label, 'BLACKLISTED');
});

test.after(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});
