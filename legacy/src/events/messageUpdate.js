import { Events } from 'discord.js';
import { config } from '../config.js';
import { logEditedMessage } from '../services/auditlog.js';
import { cacheDeletedMessageMedia } from '../services/deletedMediaCache.js';
import { onProtectedLogMessageUpdated } from '../services/logIntegrity.js';

export const name = Events.MessageUpdate;

// Member message edits are reported to the audit log channel (before/after).
// Bot and webhook messages are skipped, as are embed-only (link preview) changes.
export async function execute(oldMessage, newMessage, client) {
  if (!newMessage?.guild || newMessage.guild.id !== config.guildId) return;
  await onProtectedLogMessageUpdated(oldMessage, newMessage).catch(error =>
    console.error('[log-integrity] Could not capture log edit:', error.message));
  if (newMessage.author && !newMessage.author.bot && newMessage.attachments?.size) {
    void cacheDeletedMessageMedia(newMessage);
  }
  try {
    await logEditedMessage(client, oldMessage, newMessage);
  } catch (err) {
    console.error('[messageUpdate] Failed to log the edited message:', err);
  }
}
