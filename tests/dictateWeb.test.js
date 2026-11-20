import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { config } from '../src/config.js';
import {
  createDictateWebSession, createDictateWebHandler, dictateWebBaseUrl
} from '../src/services/dictateWeb.js';
import { execute as executeDictate } from '../src/commands/dictate.js';

const guildId = config.guildId;
const actorId = '123456789012345611';
const otherUserId = '123456789012345612';
const destinationId = '123456789012345613';
const mentionedChannelId = '123456789012345614';
const voiceChannelId = '123456789012345621';
const mentionRoleId = '123456789012345615';
const restrictedRoleId = '123456789012345616';
const botId = config.clientId || '123456789012345617';
const ownerId = '123456789012345618';
const sent = [];

let revoked = false;

const actor = {
  id: actorId, displayName: 'Manager',
  roles: { cache: new Map([[config.roleBranches.staff[1], {}]]) },
  permissions: { has: () => false },
  user: { id: actorId, username: 'manager', bot: false }
};
const other = {
  id: otherUserId, displayName: 'Recipient',
  roles: { cache: new Map() },
  permissions: { has: () => false },
  user: { id: otherUserId, username: 'recipient', bot: false }
};
const bot = { id: botId };
const permitted = { has: flag => [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages
].includes(flag) };
const target = {
  id: destinationId, name: 'announcements', rawPosition: 0,
  type: ChannelType.GuildText,
  permissionsFor: () => permitted,
  send: async payload => {
    sent.push(payload);
    return { id: '123456789012345619', url: 'https://discord.com/channels/' +
      guildId + '/' + destinationId + '/123456789012345619' };
  }
};
const mentionedChannel = {
  id: mentionedChannelId, name: 'general', rawPosition: 1,
  type: ChannelType.GuildText,
  permissionsFor: () => permitted
};
const voiceChannel = {
  id: voiceChannelId, name: 'voice-chat', rawPosition: 2,
  type: ChannelType.GuildVoice,
  permissionsFor: () => permitted
};
const audit = {
  id: config.auditLogChannelId, name: 'audit-logs',
  type: ChannelType.GuildText, isTextBased: () => true,
  send: async () => ({ id: '123456789012345620' })
};
const guild = {
  id: guildId, ownerId, name: 'Opus Client',
  roles: { cache: new Map([
    [mentionRoleId, { id: mentionRoleId, name: 'Development', managed: false,
      mentionable: true, position: 8 }],
    [restrictedRoleId, { id: restrictedRoleId, name: 'Restricted', managed: false,
      mentionable: false, position: 9 }]
  ]) },
  members: {
    me: bot,
    fetchMe: async () => bot,
    fetch: async args => {
      if (args?.limit) return new Map([[actorId, actor], [otherUserId, other]]);
      if (args?.user === actorId) return revoked ? null : actor;
      if (args?.user === otherUserId) return other;
      return null;
    }
  },
  channels: {
    cache: new Map([
      [destinationId, target], [mentionedChannelId, mentionedChannel],
      [voiceChannelId, voiceChannel],
      [config.auditLogChannelId, audit]
    ]),
    fetch: async id => guild.channels.cache.get(id) ?? null
  }
};
const client = { guilds: { cache: new Map([[guildId, guild]]) }, user: { id: botId } };

function interaction() {
  const result = { user: { id: actorId }, member: actor, guildId, guild,
    replies: [], showModal: async () => { throw new Error('Unexpected legacy modal'); },
    reply: async value => { result.replies.push(value); }
  };
  return result;
}

let server;
let url;
let previousUrl;

async function api(token, method, route, body = null, origin = url, headers = {}) {
  const response = await fetch(url + '/dictate/api/' + route, {
    method, headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...headers
    }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, json: await response.json() };
}

test.before(async () => {
  previousUrl = process.env.DICTATE_EDITOR_PUBLIC_URL;
  server = createServer((request, response) => {
    void createDictateWebHandler(client, { requireOrigin: url })(request, response)
      .catch(error => response.writeHead(500).end(error.message));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = 'http://127.0.0.1:' + server.address().port;
  process.env.DICTATE_EDITOR_PUBLIC_URL = url;
});

test('web session is private, scoped to qualified Staff and opens an actual editor', async () => {
  const command = interaction();
  await executeDictate(command);
  const reply = command.replies[0];
  assert.equal(reply.flags, 64);
  assert.equal(reply.components.length, 1);
  const button = reply.components[0].components[0].toJSON();
  assert.equal(button.label, 'Open Web Editor');
  assert.equal(button.style, 5);
  assert.ok(button.url.startsWith(url + '/dictate/#token='));
  const token = new URL(button.url).hash.split('token=')[1];
  assert.ok(token.length >= 42);
  const context = await api(token, 'GET', 'session');
  assert.equal(context.status, 200);
  assert.equal(context.json.userName, 'Manager');
  assert.ok(context.json.channelOptions.some(row => row.id === destinationId));
  assert.ok(context.json.roleOptions.some(row => row.id === mentionRoleId));
  assert.ok(!context.json.roleOptions.some(row => row.id === restrictedRoleId));
  assert.ok(context.json.userOptions.some(row => row.id === otherUserId));
  assert.ok(context.json.mentionChannelOptions.some(row => row.id === voiceChannelId));
  assert.ok(!context.json.channelOptions.some(row => row.id === voiceChannelId));
  const page = await fetch(url + '/dictate/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="picker-results"/);
  const js = await fetch(url + '/dictate/editor.js');
  assert.equal(js.status, 200);
  assert.match(await js.text(), /setRangeText\(/);
});

test('web API rejects missing tokens, cross-origin publish and protected targets', async () => {
  const missing = await api('invalid', 'GET', 'session');
  assert.equal(missing.status, 401);
  const token = new URL(createDictateWebSession(interaction()).url).hash.split('token=')[1];
  const wrongOrigin = await api(token, 'POST', 'publish',
    { channelId: destinationId, format: 'text', content: 'Hi' },
    'https://example.org');
  assert.equal(wrongOrigin.status, 403);
  const protectedTarget = await api(token, 'POST', 'publish',
    { channelId: config.auditLogChannelId, format: 'text', content: 'No' });
  assert.equal(protectedTarget.status, 400);
  assert.equal(sent.length, 0);
});

test('roles not mentionable by actor are rejected even when typed manually', async () => {
  const token = new URL(createDictateWebSession(interaction()).url).hash.split('token=')[1];
  const result = await api(token, 'POST', 'publish', {
    channelId: destinationId, format: 'text',
    content: 'Restricted <@&' + restrictedRoleId + '>'
  });
  assert.equal(result.status, 400);
  assert.match(result.json.error, /Invalid role mention/);
  assert.equal(sent.length, 0);
});

test('publish supports user, role and channel references and is strictly one-time', async () => {
  const token = new URL(createDictateWebSession(interaction()).url).hash.split('token=')[1];
  const text = 'Hello <@' + otherUserId + '> <@&' + mentionRoleId +
    '> see <#' + mentionedChannelId + '> and <#' + voiceChannelId + '>';
  const content = {
    channelId: destinationId, format: 'embed', color: '#5865F2',
    title: 'Team Notice', content: text
  };
  const [first, duplicate] = await Promise.all([
    api(token, 'POST', 'publish', content),
    api(token, 'POST', 'publish', content)
  ]);
  assert.equal([first.status, duplicate.status].filter(status => status === 200).length, 1);
  assert.ok([401, 409].includes([first.status, duplicate.status].find(status => status !== 200)));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].data.title, 'Team Notice');
  assert.deepEqual(sent[0].allowedMentions, {
    parse: [], users: [otherUserId], roles: [mentionRoleId], repliedUser: false
  });
  const again = await api(token, 'POST', 'publish', content);
  assert.equal(again.status, 401);
});

test('publishing re-checks staff rights on every API request', async () => {
  const token = new URL(createDictateWebSession(interaction()).url).hash.split('token=')[1];
  revoked = true;
  const result = await api(token, 'GET', 'session');
  assert.equal(result.status, 403);
  const rejected = await api(token, 'POST', 'publish',
    { channelId: destinationId, format: 'text', content: 'Not allowed' });
  assert.equal(rejected.status, 400);
  assert.equal(sent.length, 1);
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (previousUrl === undefined) delete process.env.DICTATE_EDITOR_PUBLIC_URL;
  else process.env.DICTATE_EDITOR_PUBLIC_URL = previousUrl;
});
