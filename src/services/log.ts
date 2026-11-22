import { config } from '../config.js';
import { buildCaseEmbed } from '../utils/embeds.js';
import { archiveLogMessage } from './logIntegrityStore.js';
import type { Guild, EmbedBuilder, MessageCreateOptions, Message } from 'discord.js';
import type { CaseRecord } from '../db.js';

export type LogOptions = {
  content?: string | null;
  files?: MessageCreateOptions['files'];
  allowedMentions?: MessageCreateOptions['allowedMentions'];
};

export async function sendChannelLog(
  guild: Guild,
  channelId: string,
  embed: EmbedBuilder,
  { content = null, files = [], allowedMentions = { parse: [] } }: LogOptions = {}
): Promise<Message | null> {
  try {
    if (!channelId || !guild || guild.id !== config.guildId) return null;
    const channel = guild.channels.cache.get(channelId) ??
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') {
      console.warn('[log] Log channel is missing or not text-based:', channelId);
      return null;
    }
    const sent = await channel.send({
      content: content ?? undefined,
      embeds: [embed],
      files,
      allowedMentions
    });
    if ([config.auditLogChannelId, config.modLogChannelId,
      config.logChannels?.automodChannelId, config.tickets?.logChannelId].includes(channelId)) {
      await archiveLogMessage(sent).catch(error =>
        console.error('[log-integrity] Cannot archive outgoing log:', error instanceof Error ? error.message : String(error)));
    }
    return sent;
  } catch (error) {
    console.error('[log] Failed to write to channel', channelId, error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function sendModLog(guild: Guild, embed: EmbedBuilder, options: LogOptions = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function sendAutoModLog(guild: Guild, embed: EmbedBuilder, options: LogOptions = {}) {
  return sendChannelLog(guild, config.logChannels?.automodChannelId, embed, options);
}

export async function sendBlacklistLog(guild: Guild, embed: EmbedBuilder, options: LogOptions = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function sendMessageActivityLog(guild: Guild, embed: EmbedBuilder, options: LogOptions = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function logCase(
  guild: Guild,
  caseRow: CaseRecord,
  { clientId = null }: { clientId?: string | null } = {}
) {
  const embed = buildCaseEmbed(caseRow, { clientId });
  if (caseRow.type === 'blacklisted') return sendBlacklistLog(guild, embed);
  if (caseRow.moderator_id === clientId && clientId) return sendAutoModLog(guild, embed);
  if (caseRow.moderator_id === 'system') return sendAutoModLog(guild, embed);
  return sendModLog(guild, embed);
}
