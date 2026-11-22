import { AuditLogEvent, ChannelType, PermissionsBitField } from 'discord.js';
import type { Guild, Client, GuildChannel, GuildTextBasedChannel, Message, PartialMessage, User, EmbedBuilder, OverwriteResolvable, MessageCreateOptions, Collection, ReadonlyCollection } from 'discord.js';

type DeletedMessage = Message | PartialMessage;
type AuditOptions = {
  messageId?: string | null;
  authorId?: string | null;
  channelId?: string | null;
};
type AuditLogSendOptions = { content?: string | null; files?: MessageCreateOptions['files'] };

import { config, updateFileConfig } from '../config.js';
import { COLORS } from '../constants.js';
import { deleteInstallMessage, getInstallMessage, getTicketByChannel, setInstallMessage } from '../db.js';
import { baseEmbed, truncate } from '../utils/embeds.js';
import { getDeletedMessageMedia, clearDeletedMessageMedia } from './deletedMediaCache.js';
import { sendMessageActivityLog } from './log.js';
import { archiveLogMessage } from './logIntegrityStore.js';

export const AUDIT_LOG_MESSAGE_KEY = 'audit_log';

export function shouldLogMessageActivity(guildId: string | null | undefined, channelId: string | null | undefined): boolean {
  if (!guildId || guildId !== config.guildId || !config.modLogChannelId || !channelId) {
    return false;
  }
  if ([config.auditLogChannelId, config.modLogChannelId,
       config.tickets?.logChannelId,
       config.logChannels?.automodChannelId,
       config.logChannels?.blacklistChannelId].filter(Boolean).includes(channelId)) {
    return false;
  }
  return !getTicketByChannel(guildId, channelId);
}

const AUDIT_CHANNEL_NAME = 'audit-log';

// Audit-log entries for message deletes age out quickly for matching purposes.
const ENTRY_MAX_AGE_MS = 10 * 1000;

// ---------- Channel management ----------

// Finds or creates the audit log channel. An existing `audit-log` channel is adopted
// before creating a fresh one; the id is persisted back to config.json either way.
export async function ensureAuditLogChannel(guild: Guild, { reason = 'Audit log channel setup' }: { reason?: string } = {}) {
  let channel = config.auditLogChannelId
    ? await guild.channels.fetch(config.auditLogChannelId).catch(() => null)
    : null;

  if (!channel) {
    const pool = (await guild.channels.fetch().catch(() => null)) ?? guild.channels.cache;
    channel = [...pool.values()].find((c) => c?.type === ChannelType.GuildText && c.name.toLowerCase() === AUDIT_CHANNEL_NAME) ?? null;
  }

  if (!channel) {
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      throw new Error(
        `No audit-log channel exists and the bot is missing **Manage Channels** - create a #${AUDIT_CHANNEL_NAME} channel manually or grant the permission, then re-run this.`,
      );
    }
    // Place it in the mod log's category (when there is one) so the logs sit together.
    const modChannel = config.modLogChannelId
      ? await guild.channels.fetch(config.modLogChannelId).catch(() => null)
      : null;
    channel = await guild.channels.create({
      name: AUDIT_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: modChannel?.parentId ?? undefined,
      permissionOverwrites: buildAuditLogOverwrites(guild),
      reason,
    });
    console.log(`[auditlog] Created the #${channel.name} channel (${channel.id}).`);
  }

  if (config.auditLogChannelId !== channel.id) {
    updateFileConfig({ auditLogChannelId: channel.id });
    console.log(`[auditlog] Saved auditLogChannelId=${channel.id} to config.json.`);
  }
  return channel;
}

// @everyone loses all view/send; the mod role keeps read-only access. The bot posts
// through its Administrator perms role (and channel-permission-free admin).
export function buildAuditLogOverwrites(guild: Guild): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];
  if (config.modRoleId) overwrites.push({ id: config.modRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] });
  return overwrites;
}

// Re-applies the seal (idempotent, same shape as the ticket/muted-cmds overwrites).
export async function applyAuditLogOverwrites(channel: GuildChannel, reason: string = 'Apply audit log overwrites') {
  await channel.permissionOverwrites.set(buildAuditLogOverwrites(channel.guild), reason);
  return channel;
}

// ---------- Notice message ----------

function buildAuditLogNotice(guild: Guild) {
  const lines = [
    '**SERVER AUDIT TRAIL**',
    'Configuration, roles, permissions, channels, integrations, invites, webhooks, threads, emoji, and server settings.',
    '',
    '**Member role and nickname changes** — actor, target and changes recorded by Discord.',
    '**Message activity** — edits, deletions and bulk removals go to #moderation-logs, not here.',
    '**Automod rules** — creation, modification and removal.',
    '',
    'Staff actions and blacklist cases go to #moderation-logs. Automated actions go to #automod-logs. Private transcripts go to #ticket-logs.',
    'Discord does not provide the contents of every uncached or deleted message. Audit attribution is shown only when verified.',
  ];
  return {
    embeds: [
      baseEmbed(COLORS.info)
        .setTitle('Audit Log')
        .setDescription(lines.join('\n'))
        .setFooter({ text: guild.name }),
    ],
  };
}

// Edits the stored notice in the audit channel, or posts a new one when missing.
export async function refreshAuditLogNotice(client: Client) {
  const channelId = config.auditLogChannelId;
  if (!channelId) return null;

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[auditlog] Audit log channel ${channelId} not found or not text-based.`);
    return null;
  }

  const payload = buildAuditLogNotice(guild);
  const stored = getInstallMessage(guild.id, AUDIT_LOG_MESSAGE_KEY);

  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message && message.author.id === client.user?.id) {
      await message.edit(payload).catch(() => {});
      return message;
    }
  }

  const sent = await channel.send(payload);
  setInstallMessage(guild.id, AUDIT_LOG_MESSAGE_KEY, channel.id, sent.id);
  return sent;
}

// Wrapper used when uninstall should not remove the audit notice (uninstall only).
export function clearAuditLogNotice(guildId: string): number {
  return deleteInstallMessage(guildId, AUDIT_LOG_MESSAGE_KEY);
}

// ---------- Sending ----------

export async function sendAuditLog(guild: Guild, embed: EmbedBuilder, { content = null, files = [] }: AuditLogSendOptions = {}) {
  try {
    if (!config.auditLogChannelId) return null;
    const channel =
      guild.channels.cache.get(config.auditLogChannelId) ??
      (await guild.channels.fetch(config.auditLogChannelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return null;
    const sent = await channel.send({ content: content ?? undefined, embeds: [embed], files, allowedMentions: { parse: [] } });
    await archiveLogMessage(sent).catch(error =>
      console.error('[log-integrity] Audit message archival failed:', (error instanceof Error ? error.message : String(error))));
    return sent;
  } catch (err) {
    console.error('[auditlog] Failed to send audit log:', (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

// ---------- Executor resolution ----------

// The Discord audit log is the only source for "who deleted it". Fetches the newest
// entries of the action and matches by target user, channel (from extra) and, when
// available, the deleted message id inside the entry changes.
async function findAuditEntry(guild: Guild, type: AuditLogEvent, { messageId = null, authorId = null, channelId = null }: AuditOptions) {
  const logs = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
  if (!logs?.entries?.size) return null;

  const now = Date.now();
  for (const entry of logs.entries.values()) {
    if (now - entry.createdTimestamp > ENTRY_MAX_AGE_MS) break;
    const extra = entry.extra as { channel?: { id?: string }; channelId?: string; count?: number } | null | undefined; // newest first; too old to trust
    if (channelId) {
      const entryChannelId = extra?.channel?.id ?? extra?.channelId ?? null;
      if (entryChannelId && entryChannelId !== channelId) continue;
    }
    if (authorId && entry.targetId && entry.targetId !== authorId) continue;
    if (messageId && Array.isArray(entry.changes) && entry.changes.some((c) => String(c.new) === messageId)) {
      return entry;
    }
    if (messageId && authorId && channelId && entry.targetId === authorId &&
        (extra?.channel?.id ?? extra?.channelId) === channelId) return entry;
    if (!messageId) return entry;
  }
  return null;
}

// Common footer/thumbnail for member-centric audit cards.
function memberCard(embed: EmbedBuilder, author: User | null | undefined, authorId: string | null, footerId: string | null = null): EmbedBuilder {
  const avatar = author?.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (avatar) embed.setThumbnail(avatar);
  embed.setFooter({ text: `ID: ${footerId ?? authorId ?? 'unknown'}` });
  return embed;
}

// ---------- Message Deleted ----------

export async function logDeletedMessage(client: Client, message: DeletedMessage) {
  const guild = message?.guild;
  if (!guild || guild.id !== config.guildId) return null;
  if (!shouldLogMessageActivity(message.guild.id, message.channel.id)) return null;

  const authorId = message.author?.id ?? null; // partial messages carry nothing but ids
  // Never log the bot's own messages - sweeps and cleanups delete enough of them.
  if (authorId === client.user?.id) return null;

  const entry = await findAuditEntry(guild, AuditLogEvent.MessageDelete, {
    messageId: message.id,
    authorId,
    channelId: message.channel.id,
  });
  const executor = entry?.executor ?? null;
  if (executor?.id === client.user?.id) return null; // bot-internal cleanups audit elsewhere
  // Unknown author + unknown executor (e.g. an uncached bot-message delete) - not actionable.
  if (!executor && !authorId) return null;
  if (!executor && authorId) {
    const authorUser = message.author ?? (await client.users.fetch(authorId).catch(() => null));
    if (authorUser?.bot) return null;
  }

  const cachedImages = await getDeletedMessageMedia(message.id);
  const lines: string[] = [];
  if (message.partial || authorId === null) {
    lines.push('Content unavailable - the message was not cached.');
  } else {
    lines.push(message.content ? truncate(message.content, 1900) : '_No text content_');

    const attachments = [...message.attachments.values()];
    if (attachments.length) {
      lines.push('');
      lines.push(`**Attachments (${attachments.length}):**`);
      for (const a of attachments.slice(0, 5)) {
        lines.push(`- [${a.name}](${a.url})${a.size ? ` (${fmtSize(a.size)})` : ''}`);
      }
      if (attachments.length > 5) lines.push(`- ...and ${attachments.length - 5} more`);
    }
    if (message.embeds?.length) lines.push(`**Embeds:** ${message.embeds.length}`);
  }

  const embed = baseEmbed(COLORS.error)
    .setTitle('Message Deleted')
    .setDescription(lines.join('\n'))
    .addFields(
      {
        name: 'Member',
        value: authorId ? `<@${authorId}>` : 'Unknown (not cached)',
        inline: true,
      },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Deleted by', value: executor ? `<@${executor.id}> (recent audit match)` : 'Unknown (possibly self-deleted)', inline: true },
    )
    .setTimestamp(Date.now());
  if (entry?.reason) embed.addFields({ name: 'Reason', value: truncate(entry.reason, 100) });
  memberCard(embed, message.author, authorId);

  const image = [...(message.attachments?.values() ?? [])].find(
    (a) => a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? ''),
  );
  if (cachedImages.length) {
    embed.setImage('attachment://' + cachedImages[0].name);
  } else if (image) {
    embed.setDescription(lines.concat('', '_Image preview unavailable: not cached before deletion._').join('\n'));
  }

  const sent = await sendMessageActivityLog(guild, embed, { files: cachedImages });
  if (sent) await clearDeletedMessageMedia(message.id);
  return sent;
}

const fmtSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

// ---------- Message Edited ----------

export async function logEditedMessage(client: Client, oldMessage: DeletedMessage, newMessage: DeletedMessage) {
  const guild = newMessage?.guild;
  if (!guild || guild.id !== config.guildId) return null;
  if (!shouldLogMessageActivity(newMessage.guild.id, newMessage.channel.id)) return null;
  const author = newMessage.author;
  if (!author || author.bot || newMessage.webhookId) return null; // bot/webhook edits are noise

  const before = oldMessage?.content ?? null;
  const after = newMessage.content ?? '';
  if (before !== null && before === after) return null; // embed/link-preview only changes

  const embed = baseEmbed(COLORS.warn)
    .setTitle('Message Edited')
    .setDescription(
      [
        `**Before:** ${before === null ? '_not cached_' : before ? truncate(before, 1200) : '_no text_'}`,
        `**After:** ${after ? truncate(after, 1200) : '_no text_'}`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Member', value: `<@${author.id}>`, inline: true },
      { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
      { name: 'Link', value: `[Jump to message](${newMessage.url})`, inline: true },
    )
    .setTimestamp(Date.now());
  memberCard(embed, author, author.id);

  return sendMessageActivityLog(guild, embed);
}

// ---------- Bulk Delete ----------

export async function logBulkDeleted(client: Client, channel: GuildTextBasedChannel, messages: ReadonlyCollection<string, DeletedMessage>) {
  const guild = channel?.guild;
  if (!guild || guild.id !== config.guildId) return null;
  if (!shouldLogMessageActivity(channel.guild.id, channel.id)) return null;

  const entry = await findAuditEntry(guild, AuditLogEvent.MessageBulkDelete, { channelId: channel.id });
  const executor = entry?.executor ?? null;
  if (executor && (executor.id === client.user?.id || executor.bot)) return null; // =purge logs its own Purge card

  const count = messages?.size ?? (entry?.extra as { count?: number } | null | undefined)?.count ?? 0;
  if (!count) return null;

  const messageList = [...(messages?.values() ?? [])];
  const timestamps = messageList.map((m) => m.createdTimestamp).filter(Boolean);
  const range = timestamps.length
    ? `<t:${Math.floor(Math.min(...timestamps) / 1000)}:R> to <t:${Math.floor(Math.max(...timestamps) / 1000)}:R>`
    : 'Unknown timeframe';

  const userIds = [...new Set(messageList.filter((m) => m.author && !m.partial).map((m) => m.author?.id).filter((id): id is string => Boolean(id)))];
  let usersLine = userIds.length
    ? userIds.slice(0, 5).map((id) => `<@${id}>`).join(', ')
    : 'Unknown (not cached)';
  if (userIds.length > 5) usersLine += ` (+${userIds.length - 5} more)`;

  const embed = baseEmbed(COLORS.audit)
    .setTitle('Bulk Delete')
    .setDescription(`${count} message(s) were removed from the channel.`)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Deleted', value: `${count}`, inline: true },
      { name: 'By', value: executor ? `<@${executor.id}>` : 'Unknown', inline: true },
      { name: 'Users', value: usersLine },
      { name: 'Timeframe', value: range },
    )
    .setTimestamp(Date.now());
  if (entry?.reason) embed.addFields({ name: 'Reason', value: truncate(entry.reason, 100) });

  return sendMessageActivityLog(guild, embed);
}
