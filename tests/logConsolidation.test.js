import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';

const folder = mkdtempSync(join(tmpdir(), 'opus-log-unified-'));
process.env.DB_PATH = join(folder, 'logs.sqlite');
const { db, createTicketRow } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const {
  shouldLogMessageActivity, logEditedMessage,
  logDeletedMessage, logBulkDeleted
} = await import('../src/services/auditlog.js');
const {
  sendModLog, sendAutoModLog, sendBlacklistLog, sendMessageActivityLog
} = await import('../src/services/log.js');

const userId = '123456789012345601';
const channelId = '123456789012345602';
const ticketId = '123456789012345603';
const sent = new Map();
for (const id of [config.auditLogChannelId, config.modLogChannelId,
    config.logChannels.automodChannelId, config.tickets.logChannelId]) sent.set(id, []);
const channel = id => ({
  id, isTextBased: () => true,
  send: async payload => { sent.get(id).push(payload); return payload; }
});
const cache = new Map([...sent.keys()].map(id => [id, channel(id)]));
const guild = {
  id: config.guildId,
  channels: { cache, fetch: async id => cache.get(id) ?? null },
  fetchAuditLogs: async () => ({ entries: new Collection() })
};
const author = { id: userId, bot: false, displayAvatarURL: () => null };
const client = { user: { id: '123456789012345604' } };
const count = id => sent.get(id)?.length ?? 0;

test('audit, security and ticket remain distinct destinations', async () => {
  const embed = { toJSON: () => ({ title: 'Example' }) };
  await sendModLog(guild, embed);
  await sendAutoModLog(guild, embed);
  await sendBlacklistLog(guild, embed);
  await sendMessageActivityLog(guild, embed, { files: [{ name: 'evidence.txt', attachment: Buffer.from('safe') }] });
  assert.equal(count(config.modLogChannelId), 3);
  assert.equal(count(config.logChannels.automodChannelId), 1);
  assert.equal(count(config.auditLogChannelId), 0);
  assert.equal(count(config.tickets.logChannelId), 0);
  assert.equal(sent.get(config.modLogChannelId)[2].files.length, 1);
  sent.get(config.modLogChannelId).length = 0;
});

test('message edits route to security and do not pollute guild audit', async () => {
  const oldMessage = { content: 'before' };
  const newMessage = {
    guild, channel: channel(channelId), channelId, content: 'after',
    author, webhookId: null, url: 'https://discord.com/channels/1/2/3'
  };
  const result = await logEditedMessage(client, oldMessage, newMessage);
  assert.ok(result);
  assert.equal(count(config.modLogChannelId), 1);
  assert.equal(count(config.auditLogChannelId), 0);
  assert.equal(result.embeds[0].data.title, 'Message Edited');
  sent.get(config.modLogChannelId).length = 0;
});

test('message deletions and bulk deletion route only to security', async () => {
  const message = {
    guild, channel: channel(channelId), channelId,
    id: '123456789012345605',
    author, partial: false, content: 'hello',
    attachments: new Collection(), embeds: []
  };
  const deleted = await logDeletedMessage(client, message);
  assert.ok(deleted);
  assert.equal(deleted.embeds[0].data.title, 'Message Deleted');
  const bulkChannel = { ...channel(channelId), guild };
  const bulk = await logBulkDeleted(client, bulkChannel, new Collection([
    [message.id, { ...message, createdTimestamp: Date.now() - 10000 }]
  ]));
  assert.ok(bulk);
  assert.equal(bulk.embeds[0].data.title, 'Bulk Delete');
  assert.equal(count(config.modLogChannelId), 2);
  assert.equal(count(config.auditLogChannelId), 0);
  sent.get(config.modLogChannelId).length = 0;
});

test('guild log destinations and private ticket channels are excluded from message tracking', async () => {
  createTicketRow({
    guildId: config.guildId, channelId: ticketId, ownerId: userId,
    type: 'security', purpose: 'Sensitive support content'
  });
  for (const id of [config.auditLogChannelId, config.modLogChannelId,
    config.logChannels.automodChannelId, config.logChannels.blacklistChannelId,
    config.tickets.logChannelId, ticketId]) {
    assert.equal(shouldLogMessageActivity(config.guildId, id), false);
  }
  assert.equal(shouldLogMessageActivity(config.guildId, channelId), true);
  assert.equal(shouldLogMessageActivity('123456789012345606', channelId), false);
  const before = count(config.modLogChannelId);
  await logEditedMessage(client, { content: 'private' }, {
    guild, channel: channel(ticketId), channelId: ticketId,
    content: 'private edited', author, webhookId: null
  });
  assert.equal(count(config.modLogChannelId), before);
});

test('ticket lifecycle activity is isolated to ticket-logs', async () => {
  const { logTicketActivity } = await import('../src/services/tickets.js');
  const before = count(config.tickets.logChannelId);
  const otherCounts = [config.modLogChannelId, config.logChannels.automodChannelId, config.auditLogChannelId].map(count);
  const result = await logTicketActivity(guild, {
    id: 71,
    ticket_number: 71,
    channel_id: ticketId,
    type: 'general'
  }, 'Claimed', userId);
  assert.ok(result);
  assert.equal(count(config.tickets.logChannelId), before + 1);
  assert.deepEqual([config.modLogChannelId, config.logChannels.automodChannelId, config.auditLogChannelId].map(count), otherCounts);
  assert.match(JSON.stringify(result.embeds[0].toJSON()), /Ticket Claimed/);
});

test.after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
