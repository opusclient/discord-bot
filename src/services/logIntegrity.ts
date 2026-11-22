import { AuditLogEvent, ChannelType, EmbedBuilder, OverwriteType, PermissionsBitField } from 'discord.js';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Guild, Client, GuildChannel, GuildBasedChannel, GuildTextBasedChannel, Message, PartialMessage, MessageCreateOptions, Collection, ReadonlyCollection } from 'discord.js';
import type { LogMessageRow, ArchiveMessage } from './logIntegrityStore.js';

type DeletionIdentity = { actorId: string | null; attribution: string; auditEntryId?: string };

type RecoveryMetadataOptions = {
  deletedAt?: number | null;
  detectedAt?: number | null;
  actorId?: string | null;
  attribution?: string;
  restoredAt?: number | null;
  missing?: string[];
  originalPosition?: boolean;
  mode?: string;
};

type AuditLookupOptions = {
  type?: AuditLogEvent;
  channelId?: string | null;
  authorId?: string | null;
  targetId?: string | null;
  detectedAt?: number;
  delayMs?: number;
};

type IncidentReportOptions = {
  title?: string;
  text?: string;
  severity?: number;
};

type RecoveryOptions = {
  detectedAt?: number;
  deletedAt?: number | null;
  actorId?: string | null;
  attribution?: string;
  channel?: GuildTextBasedChannel | null;
  channelRecreated?: boolean;
};

type DeletionEventMessage = ArchiveMessage & {
  id: string;
  guild?: Guild | null;
  channelId?: string;
  partial?: boolean;
};

type RecoveryResult = {
  markerId: string;
  contentId: string | null;
  recoveredAt: number;
  missing: string[];
};

import { config, updateFileConfig } from '../config.js';
import { sendChannelLog } from './log.js';
import {
  archiveLogMessage, countArchived, countIncidents, filesForRecovery,
  listActive, listByChannel, markDeleted, markFailed, markRestored,
  ownerDeletedLogChannel, recordIncident, snapshotChannel, storedChannel, storedMessage, storedPayload,
  waitForLogArchive
} from './logIntegrityStore.js';

const scanCap = 10000;
const recoveryCap = 5000;
const channelLocks = new Set<string>();
const recentDeletes = new Set<string>();
const ownerIntents = new Map<string, { ownerId: string; expiry: number }>();

export function authorizeOwnerLogRemoval(channelId: string, messageIds: Iterable<string>, ownerId: string): boolean {
  if (!ownerId || !channelId || !isProtectedLogChannel(channelId)) return false;
  for (const messageId of messageIds) {
    ownerIntents.set(channelId + ':' + messageId, {
      ownerId, expiry: Date.now() + 60000
    });
  }
  return true;
}
let startupRunning = false;

export function protectedLogChannelIds(): string[] {
  return [
    config.auditLogChannelId,
    config.modLogChannelId,
    config.logChannels?.automodChannelId,
    config.tickets?.logChannelId,
    config.logChannels?.blacklistChannelId
  ].filter(Boolean);
}

export function isProtectedLogChannel(channelId: string): boolean {
  return protectedLogChannelIds().includes(channelId);
}

export function isAuthorizedLogDeletion(actorId: string | null | undefined, ownerId: string | null | undefined): boolean {
  return Boolean(actorId && ownerId && actorId === ownerId);
}

function fmt(timestamp: number | null | undefined): string {
  return timestamp ? '<t:' + Math.floor(timestamp / 1000) + ':F>' +
    ' (UTC ' + new Date(timestamp).toISOString() + ')' : 'Not available';
}

function actorText(actorId: string | null | undefined, attribution: string): string {
  if (!actorId) return 'Unknown — no sufficiently matching Discord audit entry';
  return '<@' + actorId + '> (' +
    (attribution === 'audit' ? 'matched a recent audit entry; not a message-ID-level proof' :
      attribution === 'owner_self' ? 'owner-authored self-deletion assumed' :
      attribution === 'owner_command' ? 'authorized owner command' : 'unverified') + ')';
}

export function formatRecoveryMetadata(row: LogMessageRow, {
  deletedAt, detectedAt, actorId, attribution = 'unknown', restoredAt, missing = [],
  originalPosition = true, mode = 'message'
}: RecoveryMetadataOptions = {}): string {
  const snapshot = storedPayload(row);
  return [
    '**RECOVERED ' + (mode === 'channel' ? 'CHANNEL LOG ENTRY' : 'LOG MESSAGE') +
      ' — NEW COPY, NOT THE ORIGINAL**',
    '**Original channel:** <#' + row.channel_id + '>',
    '**Original message ID:** `' + row.message_id + '`',
    '**Original author:** ' + (row.author_id ? '<@' + row.author_id + '>' : snapshot?.authorName ?? 'Unknown'),
    '**Originally posted:** ' + fmt(row.posted_at),
    '**Deletion observed:** ' + (deletedAt ? fmt(deletedAt) : 'Unknown (deleted while monitoring was unavailable)'),
    '**Detected at:** ' + fmt(detectedAt),
    '**Recovered at:** ' + fmt(restoredAt),
    '**Deleted by:** ' + actorText(actorId, attribution),
    '**Position:** ' + (originalPosition ? 'New message; original message ID, timestamp and exact position cannot be restored.' :
      'Original channel was deleted; this copy is in a recreated channel.'),
    missing.length ? '**Incomplete restoration:** ' + missing.slice(0, 8).join('; ').slice(0, 750) : '**Archive status:** Content restored from available snapshot.'
  ].join('\n');
}

function auditChannelFromExtra(entry: { extra?: unknown } | null | undefined): string | null {
  const value = entry?.extra;
  if (!value || typeof value !== 'object') return null;
  const extra = value as { channel?: { id?: string }; channelId?: string };
  return extra.channel?.id ?? extra.channelId ?? null;
}

export async function identifyLogDeletionActor(guild: Guild, {
  type = AuditLogEvent.MessageDelete,
  channelId, authorId = null, targetId = null,
  detectedAt = Date.now(), delayMs = 950
}: AuditLookupOptions = {}): Promise<DeletionIdentity> {
  if (delayMs) await sleep(delayMs);
  for (let attempt = 0; attempt < (delayMs ? 3 : 1); attempt++) {
    const data = await guild.fetchAuditLogs({ type, limit: 15 }).catch(() => null);
    const matches = [...(data?.entries?.values?.() ?? [])].filter(entry => {
      if (!entry.executorId || !entry.createdTimestamp ||
          Math.abs(entry.createdTimestamp - detectedAt) > 12000) return false;
      if (type === AuditLogEvent.ChannelDelete) {
        return entry.targetId === targetId;
      }
      const channel = auditChannelFromExtra(entry);
      if (channel !== channelId) return false;
      if (type === AuditLogEvent.MessageDelete && authorId) {
        return entry.targetId === authorId;
      }
      return type === AuditLogEvent.MessageBulkDelete ||
        (authorId && entry.targetId === authorId);
    });
    if (matches.length > 1) return { actorId: null, attribution: 'ambiguous' };
    if (matches.length === 1) return { actorId: matches[0].executorId, attribution: 'audit',
      auditEntryId: matches[0].id };
    if (attempt < 2 && delayMs) await sleep(900);
  }
  return { actorId: null, attribution: 'unknown' };
}

async function reportIncident(guild: Guild, affectedChannelId: string, {
  title, text, severity = 0xd97361
}: IncidentReportOptions = {}) {
  if (!guild) return null;
  const destinations = protectedLogChannelIds().filter(id => id !== affectedChannelId);
  const preferred = affectedChannelId === config.auditLogChannelId
    ? [config.modLogChannelId, config.logChannels?.automodChannelId, config.tickets?.logChannelId]
    : [config.auditLogChannelId, config.modLogChannelId, config.logChannels?.automodChannelId, config.tickets?.logChannelId];
  const ids = [...new Set([...preferred, ...destinations])].filter(
    id => id && id !== affectedChannelId
  );
  const embed = new EmbedBuilder()
    .setColor(severity)
    .setTitle(title || 'Log Integrity Incident')
    .setDescription(String(text ?? '').slice(0, 4000))
    .setTimestamp(Date.now());
  for (const id of ids) {
    const sent = await sendChannelLog(guild, id, embed);
    if (sent) return sent;
  }
  console.error('[log-integrity] Could not post cross-channel incident', title, text);
  return null;
}

async function replaySnapshot(guild: Guild, row: LogMessageRow, targetChannel: GuildTextBasedChannel, {
  deletedAt = null, detectedAt = Date.now(),
  actorId = null, attribution = 'unknown', channelRecreated = false
}: RecoveryOptions = {}): Promise<RecoveryResult> {
  const snapshot = storedPayload(row);
  if (!snapshot) throw new Error('No snapshot payload');
  const { files, missing } = await filesForRecovery(row);
  if (snapshot.componentCount) missing.push('interactive components not replayed');
  if (snapshot.stickerCount) missing.push('stickers not replayed');
  const recoveredAt = Date.now();
  const marker = await targetChannel.send({
    content: formatRecoveryMetadata(row, {
      deletedAt, detectedAt, actorId, attribution,
      restoredAt: recoveredAt, missing, originalPosition: !channelRecreated,
      mode: channelRecreated ? 'channel' : 'message'
    }),
    allowedMentions: { parse: [] }
  });
  const textParts = String(snapshot.content ?? '').match(/[\s\S]{1,1900}/g) ?? [];
  const originalEmbeds = (snapshot.embeds ?? []).slice(0, 10);
  const flags: string[] = [];
  let contentId: string | null = null;
  if (textParts.length || originalEmbeds.length || files.length) {
    for (let i = 0; i < Math.max(1, textParts.length); i++) {
      const content = [
        '**Original content copy ' + (i + 1) + '/' + Math.max(1, textParts.length) +
          ' for `' + row.message_id + '`**',
        textParts[i] ?? ''
      ].join('\n');
      const payload: MessageCreateOptions = {
        content: content.slice(0, 2000),
        allowedMentions: { parse: [] }
      };
      if (i === 0) {
        payload.embeds = originalEmbeds;
        payload.files = files;
      }
      try {
        const copy = await targetChannel.send(payload);
        if (!contentId) contentId = copy.id;
      } catch (error) {
        flags.push('original embed or attachment replay failed (' + String((error instanceof Error ? error.message : String(error))).slice(0, 100) + ')');
        if (i === 0) {
          const fallback = await targetChannel.send({
            content, allowedMentions: { parse: [] }
          }).catch(() => null);
          if (fallback && !contentId) contentId = fallback.id;
        }
      }
    }
  }
  if (flags.length) {
    await targetChannel.send({
      content: '**Recovery warning for `' + row.message_id + '`:** ' + flags.join('; '),
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }
  return { markerId: marker.id, contentId, recoveredAt, missing: [...missing, ...flags] };
}

async function recoverRow(guild: Guild, row: LogMessageRow, {
  detectedAt = Date.now(), deletedAt = detectedAt,
  actorId = null, attribution = 'unknown', channel = null,
  channelRecreated = false
}: RecoveryOptions = {}): Promise<RecoveryResult | null> {
  if (!markDeleted(row, { at: deletedAt, actorId, attribution, status: 'recovering' })) return null;
  let target: GuildBasedChannel | null = channel;
  if (!target) {
    target = guild.channels.cache.get(row.channel_id) ??
      await guild.channels.fetch(row.channel_id).catch(() => null);
  }
  if (!target?.isTextBased() || typeof target.send !== 'function') {
    markFailed(row);
    recordIncident({ channelId: row.channel_id, messageId: row.message_id,
      type: 'message_delete', occurredAt: detectedAt, actorId, attribution,
      outcome: 'failed', details: 'Target log channel is missing' });
    await reportIncident(guild, row.channel_id, {
      title: 'Log Recovery Failed — Channel Missing',
      text: 'Original log message `' + row.message_id +
        '` cannot be restored because its channel is unavailable.'
    });
    return null;
  }
  try {
    const outcome = await replaySnapshot(guild, row, target, {
      deletedAt, detectedAt, actorId, attribution, channelRecreated
    });
    markRestored(row, outcome.markerId, outcome.recoveredAt);
    recordIncident({ channelId: row.channel_id, messageId: row.message_id,
      type: channelRecreated ? 'channel_replay' : 'message_delete',
      occurredAt: detectedAt, actorId, attribution, outcome: 'restored',
      details: { targetId: target.id, ...outcome } });
    await reportIncident(guild, row.channel_id, {
      title: 'Protected Log Restored',
      text: [
        'Original: `' + row.message_id + '` in <#' + row.channel_id + '>',
        'Recovered: <#' + target.id + '> at ' + fmt(outcome.recoveredAt),
        'Deleted by: ' + actorText(actorId, attribution),
        outcome.missing.length ? 'Some components could not be restored: ' +
          outcome.missing.join('; ').slice(0, 450) : 'Recorded archive content replayed',
        'Original position and message identity are not recoverable.'
      ].join('\n'),
      severity: 0xeaaa55
    });
    return outcome;
  } catch (error) {
    markFailed(row);
    recordIncident({ channelId: row.channel_id, messageId: row.message_id,
      type: 'message_delete', occurredAt: detectedAt, actorId, attribution,
      outcome: 'failed', details: String((error instanceof Error ? error.message : String(error))) });
    await reportIncident(guild, row.channel_id, {
      title: 'Log Recovery Failed',
      text: 'Original `' + row.message_id + '`: ' + String((error instanceof Error ? error.message : String(error))).slice(0, 550) +
        '\nDetected: ' + fmt(detectedAt) + '\nBy: ' + actorText(actorId, attribution)
    });
    return null;
  }
}

export async function onProtectedLogMessageCreated(message: Message | PartialMessage) {
  if (!message?.guild || message.guild.id !== config.guildId ||
      !isProtectedLogChannel(message.channelId)) return null;
  return archiveLogMessage(message);
}

export async function onProtectedLogMessageUpdated(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
  if (!newMessage?.guild || newMessage.guild.id !== config.guildId ||
      !isProtectedLogChannel(newMessage.channelId)) return null;
  await waitForLogArchive(newMessage.id);
  const old = storedMessage(config.guildId, newMessage.channelId, newMessage.id);
  if (!old && oldMessage?.id) await archiveLogMessage(oldMessage).catch(() => {});
  return archiveLogMessage(newMessage);
}

export async function onProtectedLogMessageDeleted(message: DeletionEventMessage, client: Client | null, {
  detectionTime = Date.now(), actor = null, fromOffline = false
}: { detectionTime?: number; actor?: DeletionIdentity | null; fromOffline?: boolean } = {}): Promise<boolean> {
  const guild = message?.guild;
  const channelId = message?.channelId ?? message?.channel?.id;
  if (!guild || !channelId || guild.id !== config.guildId || !isProtectedLogChannel(channelId)) return false;
  const messageId = message.id;
  const key = channelId + ':' + messageId;
  if (recentDeletes.has(key)) return true;
  recentDeletes.add(key);
  setTimeout(() => recentDeletes.delete(key), 60_000).unref?.();
  await waitForLogArchive(messageId);
  let row = storedMessage(guild.id, channelId, messageId);
  if (!row && !message.partial && (message.content || message.embeds?.length ||
      message.attachments?.size)) {
    row = await archiveLogMessage(message).catch(() => null);
  }
  const authorId = row?.author_id ?? message.author?.id ?? null;
  let attribution = actor ?? await identifyLogDeletionActor(guild, {
    type: AuditLogEvent.MessageDelete, channelId, authorId, detectedAt: detectionTime,
    delayMs: fromOffline ? 0 : 950
  });
  if (!attribution) attribution = { actorId: null, attribution: 'unknown' };
  let { actorId } = attribution;
  let basis = attribution.attribution ?? 'unknown';
  const ownerId = guild.ownerId;
  const intent = ownerIntents.get(key);
  ownerIntents.delete(key);
  if (intent && intent.ownerId === ownerId && intent.expiry > Date.now()) {
    actorId = ownerId;
    basis = 'owner_command';
  }
  if (!actorId && authorId && authorId === ownerId && !fromOffline) {
    actorId = ownerId;
    basis = 'owner_self';
  }
  if (isAuthorizedLogDeletion(actorId, ownerId)) {
    if (row) markDeleted(row, {
      at: detectionTime, actorId, attribution: basis, status: 'owner_deleted'
    });
    recordIncident({ channelId, messageId, type: 'message_delete',
      occurredAt: detectionTime, actorId, attribution: basis, outcome: 'owner_exempt' });
    return true;
  }
  if (!row) {
    recordIncident({ channelId, messageId, type: 'message_delete',
      occurredAt: detectionTime, actorId, attribution: basis, outcome: 'missing_snapshot',
      details: 'Original content was not captured before deletion' });
    await reportIncident(guild, channelId, {
      title: 'Log Deleted — Original Content Unavailable',
      text: [
        'Deleted message `' + messageId + '` in <#' + channelId + '>',
        'Detected: ' + fmt(detectionTime),
        'Deleted by: ' + actorText(actorId, basis),
        'No reliable pre-deletion archive was available. Exact content cannot be recovered.'
      ].join('\n')
    });
    return true;
  }
  await recoverRow(guild, row, {
    detectedAt: detectionTime, deletedAt: fromOffline ? null : detectionTime,
    actorId, attribution: basis
  });
  return true;
}

export async function onProtectedLogBulkDeleted(messages: ReadonlyCollection<string, Message | PartialMessage>, channel: GuildTextBasedChannel, client: Client): Promise<boolean> {
  if (!channel?.guild || channel.guild.id !== config.guildId ||
      !isProtectedLogChannel(channel.id)) return false;
  const detectedAt = Date.now();
  const actor = await identifyLogDeletionActor(channel.guild, {
    type: AuditLogEvent.MessageBulkDelete,
    channelId: channel.id, detectedAt
  });
  for (const message of messages.values()) {
    await onProtectedLogMessageDeleted(message, client, {
      detectionTime: detectedAt, actor
    });
  }
  return true;
}

function configChannelKey(channelId: string): string | null {
  if (channelId === config.auditLogChannelId) return 'audit';
  if (channelId === config.modLogChannelId) return 'moderation';
  if (channelId === config.logChannels?.automodChannelId) return 'automod';
  if (channelId === config.tickets?.logChannelId) return 'ticket';
  if (channelId === config.logChannels?.blacklistChannelId) return 'legacyBlacklist';
  return null;
}

export async function onProtectedLogChannelDeleted(channel: GuildChannel | { id: string; name: string; guild: Guild }, client: Client, {
  actor = null, detectedAt = Date.now()
}: { actor?: DeletionIdentity | null; detectedAt?: number } = {}): Promise<boolean> {
  const guild = channel?.guild;
  if (!guild || guild.id !== config.guildId || !isProtectedLogChannel(channel.id)) return false;
  if (channelLocks.has(channel.id)) return true;
  channelLocks.add(channel.id);
  try {
    const oldId = channel.id;
    const kind = configChannelKey(oldId);
    const snapshot = storedChannel(guild.id, oldId) ?? snapshotChannel(channel as GuildChannel, guild.id);
    const attribution = actor ?? await identifyLogDeletionActor(guild, {
      type: AuditLogEvent.ChannelDelete, targetId: oldId, detectedAt
    });
    if (isAuthorizedLogDeletion(attribution.actorId, guild.ownerId)) {
      recordIncident({ channelId: oldId, type: 'channel_delete', occurredAt: detectedAt,
        actorId: attribution.actorId, attribution: attribution.attribution,
        outcome: 'owner_exempt' });
      return true;
    }
    if (!snapshot || !kind) {
      recordIncident({ channelId: oldId, type: 'channel_delete', occurredAt: detectedAt,
        actorId: attribution.actorId, attribution: attribution.attribution,
        outcome: 'missing_snapshot' });
      await reportIncident(guild, oldId, {
        title: 'Protected Log Channel Deleted — No Snapshot',
        text: 'Channel `' + oldId + '` was deleted; channel metadata is unavailable.'
      });
      return true;
    }
    let replacement;
    try {
      replacement = await guild.channels.create({
        name: snapshot.name,
        type: ChannelType.GuildText,
        parent: snapshot.parentId || undefined,
        topic: snapshot.topic || undefined,
        position: snapshot.position,
        nsfw: snapshot.nsfw,
        permissionOverwrites: snapshot.overwrites.map(row => ({
          id: row.id, type: row.type, allow: BigInt(row.allow), deny: BigInt(row.deny)
        })),
        reason: 'Recover protected log channel ' + oldId
      });
    } catch (error) {
      recordIncident({ channelId: oldId, type: 'channel_delete', occurredAt: detectedAt,
        actorId: attribution.actorId, attribution: attribution.attribution,
        outcome: 'failed', details: String((error instanceof Error ? error.message : String(error))) });
      await reportIncident(guild, oldId, {
        title: 'Protected Log Channel Recreation Failed',
        text: 'Deleted: `' + oldId + '`. Error: ' + String((error instanceof Error ? error.message : String(error))) +
          '\nActor: ' + actorText(attribution.actorId, attribution.attribution)
      });
      return true;
    }
    if (kind === 'audit') updateFileConfig({ auditLogChannelId: replacement.id });
    if (kind === 'moderation') updateFileConfig({ modLogChannelId: replacement.id });
    if (kind === 'automod') updateFileConfig({
      logChannels: { automodChannelId: replacement.id }
    });
    if (kind === 'ticket') updateFileConfig({
      tickets: { logChannelId: replacement.id }
    });
    if (kind === 'legacyBlacklist') updateFileConfig({
      logChannels: { blacklistChannelId: replacement.id }
    });
    snapshotChannel(replacement, guild.id);
    const items = listByChannel(guild.id, oldId).slice(0, recoveryCap);
    recordIncident({ channelId: oldId, type: 'channel_delete', occurredAt: detectedAt,
      actorId: attribution.actorId, attribution: attribution.attribution,
      outcome: 'recreated', details: { replacementId: replacement.id, archivedRows: items.length } });
    await reportIncident(guild, oldId, {
      title: 'Protected Log Channel Recreated',
      text: [
        'Original: `' + oldId + '` (' + snapshot.name + ')',
        'Replacement: <#' + replacement.id + '>',
        'Deleted/detected: ' + fmt(detectedAt),
        'Actor: ' + actorText(attribution.actorId, attribution.attribution),
        'Restoring up to ' + items.length + ' archived entries in chronological order.',
        'Original Discord message IDs and exact positions cannot be recovered.'
      ].join('\n')
    });
    for (const row of items) {
      const current = storedMessage(guild.id, oldId, row.message_id);
      if (!current || current.status !== 'active') continue;
      await recoverRow(guild, current, {
        detectedAt, deletedAt: detectedAt,
        actorId: attribution.actorId, attribution: attribution.attribution,
        channel: replacement, channelRecreated: true
      });
    }
    if (listByChannel(guild.id, oldId).length > recoveryCap) {
      await reportIncident(guild, oldId, {
        title: 'Log Channel Recovery Limit Reached',
        text: 'Restored first ' + recoveryCap + ' entries in <#' + replacement.id +
          '>. Additional archived entries remain in SQLite and require manual replay.'
      });
    }
    return true;
  } finally {
    channelLocks.delete(channel.id);
  }
}

const deniedLogFlags: Array<keyof typeof PermissionsBitField.Flags> = [
  'ManageMessages',
  'ManageChannels',
  'ManageThreads',
  'ManageWebhooks',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads'
];

export async function enforceProtectedLogPermissions(guild: Guild, { dryRun = false }: { dryRun?: boolean } = {}) {
  if (!guild || guild.id !== config.guildId) return [];
  const flags = deniedLogFlags.reduce((bits, name) =>
    bits | (PermissionsBitField.Flags[name] ?? 0n), 0n);
  const changes: Array<{ channelId: string; roleId: string; hadAllowedProtectedFlags: boolean }> = [];
  for (const channelId of protectedLogChannelIds()) {
    const channel = guild.channels.cache.get(channelId) ??
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !('permissionOverwrites' in channel) || !channel.permissionOverwrites?.cache) continue;
    const overwrites = channel.permissionOverwrites.cache;
    const everyone = overwrites.get(guild.id);
    const subjects = [guild.id];
    for (const overwrite of overwrites.values()) {
      if (overwrite.id === guild.id || overwrite.id === guild.ownerId) continue;
      if ((overwrite.allow?.bitfield ?? 0n) & flags) subjects.push(overwrite.id);
    }
    for (const id of [...new Set(subjects)]) {
      const previous = overwrites.get(id);
      const allowed = previous?.allow?.bitfield ?? 0n;
      const denied = previous?.deny?.bitfield ?? 0n;
      if ((allowed & flags) === 0n && (denied & flags) === flags) continue;
      changes.push({ channelId, roleId: id,
        hadAllowedProtectedFlags: Boolean(allowed & flags) });
      if (dryRun) continue;
      const patch = Object.fromEntries(deniedLogFlags.map(flag => [flag, false]));
      await channel.permissionOverwrites.edit(id, patch, {
        type: overwrites.get(id)?.type ?? OverwriteType.Role,
        reason: 'Protected evidence logs: Owner-only deletion; read-only for all other roles'
      });
    }
  }
  return changes;
}

async function backfillChannel(guild: Guild, channel: GuildTextBasedChannel, { maxMessages = scanCap }: { maxMessages?: number } = {}) {
  const active = listActive(guild.id, channel.id);
  const seen = new Set<string>();
  let before: string | null = null;
  let complete = false;
  let count = 0;
  while (count < maxMessages) {
    const batch: Collection<string, Message> | null = await channel.messages.fetch({
      limit: 100, ...(before ? { before } : {})
    }).catch(error => {
      console.error('[log-integrity] Backfill failed', channel.id, (error instanceof Error ? error.message : String(error)));
      return null;
    });
    if (!batch) break;
    for (const message of batch.values()) {
      seen.add(message.id);
      await archiveLogMessage(message).catch(error =>
        console.error('[log-integrity] Archive failed', message.id, (error instanceof Error ? error.message : String(error)))
      );
    }
    count += batch.size;
    if (batch.size < 100 || !batch.size) {
      complete = true;
      break;
    }
    before = batch.last()?.id ?? null;
  }
  if (!complete) {
    console.warn('[log-integrity] Backfill incomplete:', channel.id, count,
      'message(s). Missing-message reconciliation postponed.');
    return { count, complete };
  }
  const missing = active.filter(row => !seen.has(row.message_id));
  for (const row of missing) {
    await onProtectedLogMessageDeleted({
      id: row.message_id, guild, channel, channelId: channel.id,
      partial: true, author: row.author_id ? { id: row.author_id } : null
    }, null, { fromOffline: true });
  }
  return { count, complete, missing: missing.length };
}

let logIntegrityInterval: NodeJS.Timeout | null = null;

export function startLogIntegrityMonitoring(client: Client, intervalMs: number = 15 * 60 * 1000): boolean {
  if (logIntegrityInterval) return false;
  logIntegrityInterval = setInterval(() => {
    void initializeLogIntegrity(client).catch(error =>
      console.error('[log-integrity] Periodic reconciliation failed:', (error instanceof Error ? error.message : String(error))));
  }, Math.max(60000, intervalMs));
  logIntegrityInterval.unref?.();
  return true;
}

export async function initializeLogIntegrity(client: Client, {
  backfill = true
}: { backfill?: boolean } = {}) {
  if (startupRunning) return null;
  startupRunning = true;
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return null;
    const output = [];
    const protectionChanges = await enforceProtectedLogPermissions(guild).catch(error => {
      console.error('[log-integrity] Immediate permission enforcement failed:', (error instanceof Error ? error.message : String(error)));
      return [];
    });
    for (const channelId of protectedLogChannelIds()) {
      const channel = guild.channels.cache.get(channelId) ??
        await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        if (ownerDeletedLogChannel(guild.id, channelId)) continue;
        const stored = storedChannel(guild.id, channelId);
        if (stored) {
          await onProtectedLogChannelDeleted({
            id: channelId, name: stored.name, guild
          }, client);
        } else {
          console.error('[log-integrity] Protected channel missing without prior snapshot:', channelId);
        }
        continue;
      }
      if ('permissionOverwrites' in channel) snapshotChannel(channel as GuildChannel, guild.id);
      if (backfill && channel.isTextBased() && 'messages' in channel) {
        const result = await backfillChannel(guild, channel);
        output.push({ channelId, ...result });
      } else {
        output.push({ channelId, protected: true });
      }
    }
    const permissions = await enforceProtectedLogPermissions(guild).catch(error => {
      console.error('[log-integrity] Permission enforcement failed:', (error instanceof Error ? error.message : String(error)));
      return [];
    });
    console.log('[log-integrity] Initialized:', JSON.stringify({
      channels: output, permissionChanges: protectionChanges.length + permissions.length,
      archived: countArchived(), incidents: countIncidents()
    }));
    return output;
  } finally {
    startupRunning = false;
  }
}
