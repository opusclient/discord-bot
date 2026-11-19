import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { isBotController, ensureBotController } from '../src/utils/permissions.js';

const id = '1900000000000000047';
const principal = '1900000000000000048';

function member(roles = [], permissions = false) {
  return {
    roles: { cache: new Map(roles.map(role => [role, { id: role }])) },
    permissions: { has: () => permissions }
  };
}

test('Discord Developer receives bot control but backend and frontend do not', () => {
  assert.deepEqual(config.botControlRoleIds, [id, principal]);
  assert.equal(isBotController(member([principal])), true);
  assert.equal(isBotController(member([id])), true);
  assert.equal(isBotController(member(['1900000000000000045'])), false);
  assert.equal(isBotController(member(['1900000000000000046'])), false);
  assert.equal(isBotController(member([])), false);
  assert.equal(isBotController({ roles: [id] }), true);
});

test('bot controller works with no Manage Server permission and is guild scoped', async () => {
  const make = (guildId, roles) => ({
    guildId,
    member: member(roles),
    replied: false,
    deferred: false,
    replies: [],
    reply(payload) { this.replies.push(payload); return Promise.resolve(); }
  });
  const allowed = make(config.guildId, [id]);
  assert.equal(await ensureBotController(allowed), true);
  assert.equal(allowed.replies.length, 0);
  const engineer = make(config.guildId, [principal]);
  assert.equal(await ensureBotController(engineer), true);
  const denied = make(config.guildId, ['1900000000000000045']);
  assert.equal(await ensureBotController(denied), false);
  assert.equal(denied.replies.length, 1);
  const regularModerator = make(config.guildId, [config.modRoleId]);
  assert.equal(await ensureBotController(regularModerator), false);
  const otherGuild = make('123456789012345678', [id]);
  assert.equal(await ensureBotController(otherGuild), false);
});

test('bot operations have explicit bot-control gates without broad moderation grants', () => {
  const files = [
    'commands/restart.js',
    'commands/setup.js',
    'commands/install.js',
    'commands/uninstall.js',
    'commands/addselfrole.js',
    'commands/removeselfrole.js',
    'ticket-actions/permanentRoleAdd.js',
    'ticket-actions/permanentRoleRemove.js'
  ];
  for (const file of files) {
    const code = readFileSync(join('src', file), 'utf8');
    assert.match(code, /ensureBotController\(interaction\)/, file);
  }
  for (const file of ['commands/ban.js', 'commands/blacklist.js', 'commands/role.js', 'commands/demote.js']) {
    const code = readFileSync(join('src', file), 'utf8');
    assert.doesNotMatch(code, /ensureBotController\(interaction\)/, file);
  }
});
