import { config } from '../config.js';
import { buildCaseEmbed } from '../utils/embeds.js';

export async function sendChannelLog(guild, channelId, embed, { content = null, files = [], allowedMentions = { parse: [] } } = {}) {
  try {
    if (!channelId || !guild || guild.id !== config.guildId) return null;
    const channel = guild.channels.cache.get(channelId) ??
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
      console.warn('[log] Log channel is missing or not text-based:', channelId);
      return null;
    }
    return await channel.send({
      content,
      embeds: [embed],
      files,
      allowedMentions
    });
  } catch (error) {
    console.error('[log] Failed to write to channel', channelId, error.message);
    return null;
  }
}

export async function sendModLog(guild, embed, options = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function sendAutoModLog(guild, embed, options = {}) {
  return sendChannelLog(guild, config.logChannels?.automodChannelId, embed, options);
}

export async function sendBlacklistLog(guild, embed, options = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function sendMessageActivityLog(guild, embed, options = {}) {
  return sendChannelLog(guild, config.modLogChannelId, embed, options);
}

export async function logCase(guild, caseRow, { clientId = null } = {}) {
  const embed = buildCaseEmbed(caseRow, { clientId });
  if (caseRow.type === 'blacklisted') return sendBlacklistLog(guild, embed);
  if (caseRow.moderator_id === clientId && clientId) return sendAutoModLog(guild, embed);
  if (caseRow.moderator_id === 'system') return sendAutoModLog(guild, embed);
  return sendModLog(guild, embed);
}
