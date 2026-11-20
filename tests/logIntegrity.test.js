import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogEvent, Collection, PermissionsBitField } from 'discord.js';

const dir = mkdtempSync(join(tmpdir(), 'opus-log-integrity-'));
process.env.DB_PATH = join(dir, 'integrity.sqlite');
process.env.LOG_INTEGRITY_DIR = join(dir, 'archive');
const fixture = join(dir, 'guild-config.json');
writeFileSync(fixture, readFileSync(process.env.CONFIG_PATH || 'config.json'));
process.env.CONFIG_PATH = fixture;

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const {
  archiveLogMessage, storedMessage, storedPayload, filesForRecovery, snapshotChannel,
  recordIncident, countArchived, countIncidents
} = await import('../src/services/logIntegrityStore.js');
const {
  isProtectedLogChannel, protectedLogChannelIds, isAuthorizedLogDeletion,
  formatRecoveryMetadata, identifyLogDeletionActor, onProtectedLogMessageDeleted,
  onProtectedLogBulkDeleted, onProtectedLogChannelDeleted, initializeLogIntegrity,
  authorizeOwnerLogRemoval, enforceProtectedLogPermissions
} = await import('../src/services/logIntegrity.js');

const guildId = config.guildId;
const ownerId = '123456789012345671';
const managerId = '123456789012345672';
const botId = '123456789012345673';
let next = 123456789012340000n;
const sends = new Map();
const channels = new Map();

function makeChannel(id, name) {
  const previous = new Map();
  const channel = {
    id, name, guild: null, parentId: '123456789012345670',
    rawPosition: 1, topic: 'Evidence retained',
    permissionOverwrites: {
      cache: new Map([['123456789012345679', {
        id: '123456789012345679', type: 0,
        allow: new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
        deny: new PermissionsBitField(PermissionsBitField.Flags.ManageMessages)
      }]]),
      edit: async (roleId, patch) => {
        const current = channel.permissionOverwrites.cache.get(roleId);
        let allowed = current?.allow?.bitfield ?? 0n;
        let denied = current?.deny?.bitfield ?? 0n;
        for (const [flagName, enabled] of Object.entries(patch)) {
          const flag = PermissionsBitField.Flags[flagName];
          if (!flag) continue;
          if (enabled === false) {
            denied |= flag;
            allowed &= ~flag;
          }
        }
        channel.permissionOverwrites.cache.set(roleId, {
          id: roleId, type: 0,
          allow: new PermissionsBitField(allowed),
          deny: new PermissionsBitField(denied)
        });
        return channel;
      }
    },
    messages: {
      fetch: async () => new Collection([...previous.entries()])
    },
    isTextBased: () => true,
    send: async payload => {
      const message = {
        id: String(next++),
        channelId: channel.id,
        guild: channel.guild,
        author: { id: botId, username: 'Opus System' },
        content: payload.content ?? '',
        embeds: payload.embeds ?? [],
        attachments: new Collection(),
        createdTimestamp: Date.now()
      };
      sends.get(id).push({ payload, message });
      previous.set(message.id, message);
      return message;
    }
  };
  sends.set(id, []);
  channels.set(id, channel);
  return channel;
}

const auditChannel = makeChannel(config.auditLogChannelId, 'audit-logs');
const moderationChannel = makeChannel(config.modLogChannelId, 'moderation-logs');
const autoChannel = makeChannel(config.logChannels.automodChannelId, 'automod-logs');
const ticketChannel = makeChannel(config.tickets.logChannelId, 'ticket-logs');
const oldBlacklistChannel = makeChannel(config.logChannels.blacklistChannelId, 'archived-blacklist-records');

const guild = {
  id: guildId, ownerId, name: 'Opus Client Test',
  channels: {
    cache: channels,
    fetch: async id => channels.get(id) ?? null,
    create: async options => {
      const channel = makeChannel(String(next++), options.name);
      channel.guild = guild;
      channel.parentId = options.parent ?? null;
      return channel;
    }
  },
  fetchAuditLogs: async () => ({ entries: new Collection() })
};
for (const channel of channels.values()) channel.guild = guild;
const client = { guilds: { cache: new Map([[guildId, guild]]) }, user: { id: botId } };

function message(id, channel = moderationChannel, {
  authorId = botId, content = 'Original protected evidence', attachments = null
} = {}) {
  return {
    id, channelId: channel.id, channel, guild,
    author: { id: authorId, username: 'Opus System' },
    content, embeds: [], components: [],
    attachments: attachments ?? new Collection(),
    createdTimestamp: Date.now() - 60000
  };
}

test('four active logs and the legacy evidence archive are protected', () => {
  assert.equal(protectedLogChannelIds().length, 5);
  for (const channel of [auditChannel, moderationChannel, autoChannel, ticketChannel, oldBlacklistChannel]) {
    assert.equal(isProtectedLogChannel(channel.id), true);
  }
  assert.equal(isProtectedLogChannel(config.logChannels.blacklistChannelId), true);
  assert.equal(isProtectedLogChannel('123456789012345600'), false);
  assert.equal(isAuthorizedLogDeletion(ownerId, ownerId), true);
  assert.equal(isAuthorizedLogDeletion(managerId, ownerId), false);
});

test('role-level log deletion permissions are explicitly denied without suppressing ViewChannel', async () => {
  const before = await enforceProtectedLogPermissions(guild, { dryRun: true });
  assert.ok(before.length >= protectedLogChannelIds().length);
  const changed = await enforceProtectedLogPermissions(guild);
  assert.ok(changed.length >= protectedLogChannelIds().length);
  const again = await enforceProtectedLogPermissions(guild, { dryRun: true });
  assert.equal(again.length, 0);
  for (const channel of channels.values()) {
    const everyone = channel.permissionOverwrites.cache.get(guild.id);
    assert.equal(everyone.deny.has(PermissionsBitField.Flags.ManageMessages), true);
    assert.equal(everyone.deny.has(PermissionsBitField.Flags.ManageChannels), true);
    assert.equal(everyone.deny.has(PermissionsBitField.Flags.SendMessages), true);
  }
  assert.equal(moderationChannel.permissionOverwrites.cache.get('123456789012345679')
    .allow.has(PermissionsBitField.Flags.ViewChannel), true);
});

test('snapshots persist original content, author and archived attachment hash', async () => {
  const attachmentId = '123456789012345680';
  const original = message('123456789012345681', moderationChannel, {
    content: 'Evidence including an attachment',
    attachments: new Collection([[attachmentId, {
      id: attachmentId, name: 'evidence.txt',
      contentType: 'text/plain', size: 9,
      url: 'https://cdn.discordapp.com/attachments/test/evidence.txt'
    }]])
  });
  const row = await archiveLogMessage(original, {
    fetcher: async () => new Response(Buffer.from('archive01'), {
      status: 200, headers: { 'content-length': '9' }
    })
  });
  assert.equal(row.status, 'active');
  assert.equal(storedPayload(row).content, original.content);
  const files = await filesForRecovery(row);
  assert.equal(files.files.length, 1);
  assert.deepEqual(files.missing, []);
  assert.ok(storedPayload(row).attachments[0].sha256);
});

test('nonowner deletion reconstructs archived content and records original, deletion and restore times', async () => {
  const id = '123456789012345682';
  const original = message(id, moderationChannel, { content: 'Test log that must remain intact' });
  await archiveLogMessage(original);
  const before = sends.get(moderationChannel.id).length;
  const detectedAt = Date.now();
  assert.equal(await onProtectedLogMessageDeleted(original, client, {
    detectionTime: detectedAt,
    actor: { actorId: managerId, attribution: 'audit' }
  }), true);
  const row = storedMessage(guildId, moderationChannel.id, id);
  assert.equal(row.status, 'restored');
  assert.equal(row.deleted_by, managerId);
  assert.ok(row.restored_id);
  assert.ok(row.restored_at >= detectedAt);
  const newMessages = sends.get(moderationChannel.id).slice(before);
  assert.ok(newMessages.length >= 2);
  assert.match(newMessages[0].payload.content, /RECOVERED LOG MESSAGE/);
  assert.match(newMessages[0].payload.content, /Original message ID/);
  assert.match(newMessages[0].payload.content, /Originally posted/);
  assert.match(newMessages[0].payload.content, /Deletion observed/);
  assert.match(newMessages[0].payload.content, /Recovered at/);
  assert.match(newMessages[0].payload.content, /123456789012345672/);
  assert.match(newMessages[1].payload.content, /Test log that must remain intact/);
  assert.deepEqual(newMessages[0].payload.allowedMentions, { parse: [] });
  assert.deepEqual(newMessages[1].payload.allowedMentions, { parse: [] });
  assert.equal(sends.get(auditChannel.id).at(-1).payload.embeds[0].data.title, 'Protected Log Restored');
  assert.ok(countIncidents().some(row => row.type === 'message_delete' && row.outcome === 'restored'));
});

test('no duplicate restoration occurs for repeated gateway events', async () => {
  const id = '123456789012345682';
  const before = sends.get(moderationChannel.id).length;
  await onProtectedLogMessageDeleted(message(id), client, {
    actor: { actorId: managerId, attribution: 'audit' }
  });
  assert.equal(sends.get(moderationChannel.id).length, before);
});

test('verified owner deletion is exempt without replay', async () => {
  const original = message('123456789012345683', auditChannel);
  await archiveLogMessage(original);
  const before = sends.get(auditChannel.id).length;
  await onProtectedLogMessageDeleted(original, client, {
    actor: { actorId: ownerId, attribution: 'audit' }
  });
  assert.equal(storedMessage(guildId, auditChannel.id, original.id).status, 'owner_deleted');
  assert.equal(sends.get(auditChannel.id).length, before);
});

test('owner-authorized bot purge is not reversed', async () => {
  const original = message('123456789012345684', auditChannel);
  await archiveLogMessage(original);
  authorizeOwnerLogRemoval(auditChannel.id, [original.id], ownerId);
  const before = sends.get(auditChannel.id).length;
  await onProtectedLogMessageDeleted(original, client, {
    actor: { actorId: botId, attribution: 'audit' }
  });
  assert.equal(storedMessage(guildId, auditChannel.id, original.id).status, 'owner_deleted');
  assert.equal(sends.get(auditChannel.id).length, before);
});

test('a missing snapshot produces a clear incident, never invented content', async () => {
  const original = message('123456789012345685', autoChannel, { content: '' });
  original.partial = true;
  const before = sends.get(auditChannel.id).length;
  await onProtectedLogMessageDeleted(original, client, {
    actor: { actorId: managerId, attribution: 'audit' }
  });
  assert.equal(storedMessage(guildId, autoChannel.id, original.id), null);
  assert.ok(countIncidents().some(row => row.outcome === 'missing_snapshot'));
  assert.ok(sends.get(auditChannel.id).length > before);
});

test('audit attribution requires a matching channel, author and recent timestamp', async () => {
  const now = Date.now();
  const candidate = {
    id: '123456789012345689',
    action: AuditLogEvent.MessageDelete,
    createdTimestamp: now + 200,
    targetId: botId,
    executorId: managerId,
    extra: { channel: { id: moderationChannel.id } }
  };
  guild.fetchAuditLogs = async () => ({ entries: new Collection([
    [candidate.id, candidate]
  ]) });
  assert.deepEqual(await identifyLogDeletionActor(guild, {
    type: AuditLogEvent.MessageDelete,
    channelId: moderationChannel.id, authorId: botId, detectedAt: now, delayMs: 0
  }), {
    actorId: managerId, attribution: 'audit', auditEntryId: candidate.id
  });
  const unrelated = await identifyLogDeletionActor(guild, {
    type: AuditLogEvent.MessageDelete,
    channelId: auditChannel.id, authorId: botId, detectedAt: now, delayMs: 0
  });
  assert.equal(unrelated.actorId, null);
  guild.fetchAuditLogs = async () => ({ entries: new Collection() });
});

test('channel deletion is rebuilt from a snapshot and recorded as a new channel', async () => {
  const oldId = config.tickets.logChannelId;
  const original = message('123456789012345686', ticketChannel, {
    content: 'Private support ticket evidence'
  });
  snapshotChannel(ticketChannel, guildId);
  await archiveLogMessage(original);
  const countBefore = channels.size;
  await onProtectedLogChannelDeleted(ticketChannel, client, {
    actor: { actorId: managerId, attribution: 'audit' }
  });
  assert.equal(channels.size, countBefore + 1);
  assert.notEqual(config.tickets.logChannelId, oldId);
  const replacement = channels.get(config.tickets.logChannelId);
  assert.equal(replacement.name, 'ticket-logs');
  assert.equal(replacement.parentId, ticketChannel.parentId);
  assert.ok(sends.get(replacement.id).some(item =>
    item.payload.content?.includes('RECOVERED CHANNEL LOG ENTRY')));
  const originalRow = storedMessage(guildId, oldId, original.id);
  assert.equal(originalRow.status, 'restored');
  assert.ok(countIncidents().some(row => row.type === 'channel_delete' && row.outcome === 'recreated'));
  config.tickets.logChannelId = oldId;
});

test('owner deleting an entire log channel is exempt', async () => {
  const old = config.tickets.logChannelId;
  const before = channels.size;
  await onProtectedLogChannelDeleted(ticketChannel, client, {
    actor: { actorId: ownerId, attribution: 'audit' }
  });
  assert.equal(config.tickets.logChannelId, old);
  assert.equal(channels.size, before);
  assert.ok(countIncidents().some(row => row.type === 'channel_delete' && row.outcome === 'owner_exempt'));
});

test('owner-deleted log channels stay deleted after a later restart or reconciliation', async () => {
  const oldId = config.tickets.logChannelId;
  const original = channels.get(oldId);
  assert.ok(original);
  channels.delete(oldId);
  const before = channels.size;
  try {
    await initializeLogIntegrity(client, { backfill: false });
    assert.equal(channels.size, before);
    assert.equal(config.tickets.logChannelId, oldId);
  } finally {
    channels.set(oldId, original);
  }
});

test('startup archive backfills existing history without creating unnecessary recovery messages', async () => {
  const source = message('123456789012345687', autoChannel, {
    content: 'Historical AutoMod alert'
  });
  const original = autoChannel.messages.fetch;
  autoChannel.messages.fetch = async () => new Collection([[source.id, source]]);
  const previous = storedMessage(guildId, autoChannel.id, source.id);
  assert.equal(previous, null);
  try {
    const result = await initializeLogIntegrity(client);
    assert.ok(Array.isArray(result));
    assert.equal(storedMessage(guildId, autoChannel.id, source.id).status, 'active');
    assert.ok(countArchived().some(row => row.channel_id === autoChannel.id));
  } finally {
    autoChannel.messages.fetch = original;
  }
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
