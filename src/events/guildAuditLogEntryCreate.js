import { AuditLogEvent, Events } from 'discord.js';
import { getTicketByChannel } from '../db.js';
import { config } from '../config.js';
import { sendAuditLog } from '../services/auditlog.js';
import { sendAutoModLog, sendModLog } from '../services/log.js';
import { auditDestination, buildGuildAuditEmbed } from '../services/guildAuditEvents.js';

const ticketAuditActions = new Set([
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.ThreadCreate,
  AuditLogEvent.ThreadUpdate,
  AuditLogEvent.ThreadDelete
]);

export function isTicketAuditEntry(entry, guildId) {
  if (!ticketAuditActions.has(entry?.action)) return false;
  const categories = new Set(Object.values(config.tickets?.typeCategoryIds ?? {}).filter(Boolean));
  const parentIds = [
    entry.target?.parentId,
    entry.target?.parent_id,
    entry.extra?.channel?.parentId,
    entry.extra?.channel?.parent_id,
    ...(entry.changes ?? []).filter(change => change.key === 'parent_id')
      .flatMap(change => [change.old, change.new])
  ];
  if (parentIds.some(id => categories.has(id))) return true;
  const channelIds = [
    entry.targetId,
    entry.target?.id,
    entry.extra?.channel?.id,
    entry.extra?.channelId
  ].filter(Boolean);
  return channelIds.some(id => Boolean(getTicketByChannel(guildId, id)));
}

export const name = Events.GuildAuditLogEntryCreate;
const processed=new Map();

export async function execute(entry, guild, client){
  if(!entry||!guild||guild.id!==config.guildId)return;
  const key=entry.id??String(entry.action)+':'+String(entry.createdTimestamp)+':'+String(entry.targetId);
  if(processed.has(key))return;
  processed.set(key,Date.now());
  if(processed.size>700){
    const oldest=[...processed.keys()].slice(0,350);
    for(const id of oldest)processed.delete(id);
  }
  const destination=auditDestination(entry,{
    botId:client.user.id,
    muteRoleId:config.muteRoleId
  });
  if(destination==='none'||isTicketAuditEntry(entry,guild.id))return;
  try{
    if(destination==='audit'||destination==='moderation-and-audit'){
      await sendAuditLog(guild,buildGuildAuditEmbed(entry,{
        category:'audit',guildName:guild.name
      }));
    }
    if(destination==='moderation'||destination==='moderation-and-audit'){
      await sendModLog(guild,buildGuildAuditEmbed(entry,{
        category:'moderation',guildName:guild.name
      }));
    }
    if(destination==='automod'){
      await sendAutoModLog(guild,buildGuildAuditEmbed(entry,{
        category:'automod',guildName:guild.name
      }));
    }
  }catch(error){
    console.error('[audit-events] Could not route audit entry:',entry.id,error.message);
  }
}
