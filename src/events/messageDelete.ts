import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { logDeletedMessage } from '../services/auditlog.js';
import { onProtectedLogMessageDeleted } from '../services/logIntegrity.js';

export const name = Events.MessageDelete;

// Deleted messages (text, images, attachments) land in the audit log channel,
// with the deleting moderator resolved from the Discord audit log.
export async function execute(message: ClientEvents['messageDelete'][0], client: Client) {
  if (!message?.guild || message.guild.id !== config.guildId) return;
  try {
    if (await onProtectedLogMessageDeleted(message, client)) return;
    await logDeletedMessage(client, message);
  } catch (err) {
    console.error('[messageDelete] Failed to log the deleted message:', err);
  }
}
