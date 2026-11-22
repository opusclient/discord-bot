import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { buildRoleNotification, buildRoleOperationResult, ROLE_RESULTS_PER_PAGE, ticketPanelUrl } from '../src/services/roleEmbeds.js';

const guild = {
  id: '1566400594267213887',
  name: 'Opus Client',
  iconURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
};
const moderator = { id: '123456789012345670', username: 'zvwgvx' };
const developer = { id: '123456789012345671', name: 'Developer', position: 50 };
const linked = { id: '123456789012345672', name: 'Linked', position: 10 };
const tester = { id: '123456789012345673', name: 'Beta Tester', position: 20 };
const member = { id: '123456789012345674', user: { id: '123456789012345674' } };

const allText = value => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(allText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(allText).join('\n');
  return '';
};

test('demotion DM renders an official, high contrast Components V2 notification', () => {
  const payload = buildRoleNotification({
    member,
    fromRole: developer,
    toRole: linked,
    mode: 'demote',
    guild,
    moderator,
    reason: 'Internal reorganization',
    referenceId: '123456789012345675',
    timestamp: Date.UTC(2026, 10, 19, 5, 58)
  });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.components.length, 1);
  const container = payload.components[0].toJSON();
  const text = allText(container);
  assert.match(text, /Staff demotion/);
  assert.match(text, /POSITION UPDATE/);
  assert.match(text, /Developer/);
  assert.match(text, /Linked/);
  assert.match(text, new RegExp(developer.id));
  assert.match(text, new RegExp(linked.id));
  assert.match(text, /zvwgvx/);
  assert.match(text, /Internal reorganization/);
  assert.match(text, /123456789012345675/);
  assert.doesNotMatch(text, /<@&|unknown-role/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.match(text, /Open Support Ticket/);
  assert.match(text, /https:\/\/discord.com\/channels\//);
});

test('promotion without from_role retains previous roles and shows the new role prominently', () => {
  const payload = buildRoleNotification({
    member, fromRole: null, toRole: developer, mode: 'promote', guild, moderator
  });
  const text = allText(payload.components[0].toJSON());
  assert.match(text, /Staff promotion/);
  assert.match(text, /POSITION UPDATE/);
  assert.match(text, /Developer/);
  assert.match(text, /Other independent roles were retained/);
  assert.doesNotMatch(text, /Not specified/);
});

test('demotion without to_role displays Regular Member and all removed staff roles', () => {
  const payload = buildRoleNotification({
    member, fromRole: tester, toRole: null, removedRoles: [tester, developer],
    mode: 'demote', guild, moderator, regularMember: true
  });
  const text = allText(payload.components[0].toJSON());
  assert.match(text, /Regular Member/);
  assert.match(text, /Beta Tester/);
  assert.match(text, /Roles removed \(2\)/);
  assert.match(text, /Developer/);
  assert.doesNotMatch(text, /Not specified|undefined/);
});

test('role add and remove use compact Components V2 notifications', () => {
  for (const [mode, title, section] of [
    ['add', 'Role assigned', 'ASSIGNED ROLE'],
    ['remove', 'Role removed', 'REMOVED ROLE']
  ]) {
    const payload = buildRoleNotification({ member, toRole: linked, mode, guild, moderator });
    const text = allText(payload.components[0].toJSON());
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.match(text, new RegExp(title));
    assert.match(text, new RegExp(section));
    assert.match(text, /Linked/);
    assert.match(text, new RegExp(linked.id));
    assert.doesNotMatch(text, /No additional reason|<@&/);
  }
});

test('ticket link uses only a real configured channel and guild', () => {
  assert.equal(ticketPanelUrl(guild.id, '1566420401578315846'), 'https://discord.com/channels/1566400594267213887/1566420401578315846');
  assert.equal(ticketPanelUrl(guild.id, 'invalid'), null);
  assert.equal(ticketPanelUrl('invalid', '1566420401578315846'), null);
});

test('requester response highlights summary, transitions and useful corrections', () => {
  const records = [
    { id: member.id, name: 'Minh Anh', status: 'success', fromRole: developer, toRole: linked, dmDelivered: true },
    { id: '123456789012345676', name: 'Another user', status: 'failed', fromRole: tester, toRole: linked, dmDelivered: false, error: 'Member does not have the source role.' }
  ];
  const embed = buildRoleOperationResult({
    mode: 'demote', guild, moderator, records, page: 0, reason: 'Staff review', referenceId: '123456789012345675'
  }).toJSON();
  assert.match(embed.title, /PARTIAL SUCCESS/);
  assert.match(embed.description, /1 \/ 2 changes applied/);
  assert.match(embed.description, /Staff review/);
  assert.match(embed.fields[0].value, /Developer.*Linked/);
  assert.match(embed.fields[0].value, /Delivered via DM/);
  assert.match(embed.fields[1].value, /No role changes applied/);
  assert.match(embed.fields[1].value, /Next step/);
  assert.match(embed.fields[1].value, /from_role/);
  assert.match(embed.footer.text, /1\/1.*Ref 123456789012345675/);
  assert.ok(embed.fields.every(field => field.name.length <= 256 && field.value.length <= 1024));
});

test('result messages explain additive promotions and complete staff removal', () => {
  const records = [
    { id: member.id, name: 'Minh Anh', status: 'success', fromRole: null, toRole: developer, dmDelivered: true },
    { id: tester.id, name: 'Tester', status: 'success', fromRole: tester, toRole: null, removedRoles: [tester, developer], dmDelivered: true }
  ];
  const a = buildRoleOperationResult({
    mode: 'promote', guild, moderator, records: [records[0]]
  }).toJSON();
  assert.match(a.fields[0].value, /Assigned/);
  records[1].regularMember = true;
  const b = buildRoleOperationResult({
    mode: 'demote', guild, moderator, records: [records[1]]
  }).toJSON();
  assert.match(b.fields[0].value, /Regular Member/);
  assert.match(b.fields[0].value, /Roles removed \(2\)/);
});

test('large batches produce valid distinct result pages', () => {
  const records = Array.from({ length: 50 }, (_, index) => ({
    id: String(123456789012345670n + BigInt(index)),
    name: 'Team member ' + index,
    status: 'success',
    toRole: linked,
    dmDelivered: index % 2 === 0
  }));
  assert.equal(ROLE_RESULTS_PER_PAGE, 5);
  for (let page = 0; page < 10; page++) {
    const embed = buildRoleOperationResult({ mode: 'add', guild, moderator, records, page }).toJSON();
    assert.equal(embed.fields.length, ROLE_RESULTS_PER_PAGE);
    assert.match(embed.footer.text, new RegExp((page + 1) + '/10'));
    assert.match(embed.fields[0].name, new RegExp('Team member ' + page * ROLE_RESULTS_PER_PAGE));
    assert.ok(JSON.stringify(embed).length < 6000);
  }
});
