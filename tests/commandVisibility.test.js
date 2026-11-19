import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { MessageFlags, ApplicationCommandOptionType } from 'discord.js';
import { loadCommands } from '../src/utils/loaders.js';
import { visibilityFlags, installHideOption } from '../src/utils/visibility.js';
import { buildHelpPanel, helpPanelId, parseHelpPanelId } from '../src/services/helpPanel.js';

const commands = await loadCommands(path.resolve('src/commands'), new Map());
const memberId = '1900000000000000001';

test('all 24 slash commands have optional hide on every route', () => {
  assert.equal(commands.size, 24);
  for (const [name, mod] of commands) {
    const data = mod.data.toJSON();
    const subs = data.options?.filter(option => option.type === ApplicationCommandOptionType.Subcommand) ?? [];
    const paths = subs.length ? subs : [data];
    for (const item of paths) {
      const options = item.options ?? [];
      const matches = options.filter(option => option.name === 'hide');
      assert.equal(matches.length, 1, name + ':' + (item.name || 'root'));
      assert.equal(matches[0].type, ApplicationCommandOptionType.Boolean);
      assert.equal(matches[0].required ?? false, false);
      assert.equal(options.at(-1).name, 'hide');
    }
  }
});

test('adding hide is idempotent and preserves required parameter ordering', () => {
  const data = commands.get('promote').data;
  const first = JSON.stringify(data.toJSON());
  installHideOption(data);
  assert.equal(JSON.stringify(data.toJSON()), first);
  const options = data.toJSON().options;
  assert.deepEqual(options.map(x => x.name), ['users', 'to_role', 'from_role', 'reason', 'hide']);
  assert.equal(options[1].required, true);
});

test('public is the default; hide yes is ephemeral', () => {
  assert.equal(visibilityFlags({ options: { getBoolean: () => null } }), 0);
  assert.equal(visibilityFlags({ options: { getBoolean: () => false } }), 0);
  assert.equal(visibilityFlags({ options: { getBoolean: () => true } }), MessageFlags.Ephemeral);
  assert.equal(visibilityFlags({ options: {} }), 0);
});

test('help components have staff navigation and prominent categorized content', () => {
  const panel = buildHelpPanel({
    guildName: 'Opus Client',
    icon: 'https://cdn.discordapp.com/embed/avatars/0.png',
    commandCount: commands.size,
    userId: memberId,
    isStaff: true
  });
  assert.equal(panel.flags, MessageFlags.IsComponentsV2);
  assert.equal(panel.components.length, 1);
  const text = JSON.stringify(panel.components[0].toJSON());
  assert.match(text, /Command Center/);
  assert.match(text, /Opus Client/);
  assert.match(text, /GETTING STARTED/);
  assert.match(text, /hide: Yes/);
  for (const page of ['overview', 'moderation', 'team', 'system']) {
    assert.ok(text.includes(helpPanelId(memberId, page)));
    assert.deepEqual(parseHelpPanelId(helpPanelId(memberId, page)), { userId: memberId, page });
  }
  const moderation = JSON.stringify(buildHelpPanel({
    userId: memberId, isStaff: true, page: 'moderation'
  }).components[0].toJSON());
  assert.match(moderation, /ENFORCEMENT/);
  assert.match(moderation, /punishments clear/);
  assert.doesNotMatch(moderation, /SYSTEM OPERATIONS/);
});

test('regular members cannot navigate staff-only help pages', () => {
  const panel = buildHelpPanel({
    userId: memberId, isStaff: false, page: 'moderation'
  });
  const payload = JSON.stringify(panel.components[0].toJSON());
  assert.match(payload, /GETTING STARTED/);
  assert.doesNotMatch(payload, /ENFORCEMENT/);
  assert.doesNotMatch(payload, /opus_help:.*:team/);
  assert.equal(parseHelpPanelId('opus_help:invalid:system'), null);
});

test('/help is public by default and private when hide is true', async () => {
  const responses = [];
  const interaction = {
    guild: { name: 'Opus Client', iconURL: () => null },
    user: { id: memberId },
    options: { getBoolean: () => null },
    member: { roles: { cache: new Map() } },
    reply: async value => responses.push(value)
  };
  const client = {
    user: { displayAvatarURL: () => null },
    commands
  };
  await commands.get('help').execute(interaction, client);
  interaction.options.getBoolean = () => true;
  await commands.get('help').execute(interaction, client);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].flags & MessageFlags.Ephemeral, 0);
  assert.equal(responses[1].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  assert.ok(responses.every(reply => reply.flags & MessageFlags.IsComponentsV2));
});
