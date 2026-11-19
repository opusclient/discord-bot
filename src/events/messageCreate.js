import { Events } from 'discord.js';
import { config } from '../config.js';
import { getTicketByChannel } from '../db.js';
import { handleDoNotType } from '../prefix/doNotType.js';
import { processBoostSystemMessage } from '../services/boosts.js';
import { isBoostSystemMessage } from '../services/boostFormat.js';
import { cacheDeletedMessageMedia } from '../services/deletedMediaCache.js';

export const name = Events.MessageCreate;

export async function execute(message, client) {
  if (!message.guild || message.guild.id !== config.guildId) return;
  if (!message.author?.bot && message.channelId !== config.auditLogChannelId) {
    void cacheDeletedMessageMedia(message);
  }

  if (isBoostSystemMessage(message, config.boosts?.channelId)) {
    await processBoostSystemMessage(message, client).catch(error =>
      console.error('[boosts] Live event failed:', error.message)
    );
    return;
  }

  if (
    config.doNotType?.channelId &&
    message.channelId === config.doNotType.channelId &&
    message.author.id !== client.user.id
  ) {
    await handleDoNotType(message, client);
    return;
  }

  if (message.author.bot) return;

  const ticketChannelId = message.channel?.isThread?.() ? message.channel.parentId : message.channelId;
  const ticket = ticketChannelId ? getTicketByChannel(message.guild.id, ticketChannelId) : null;
  if (ticket && ticket.status !== 'open') {
    await message.delete().catch(error =>
      console.warn('[tickets] Could not remove a message in archived ticket ' + ticketChannelId + ': ' + error.message)
    );
  }
}
