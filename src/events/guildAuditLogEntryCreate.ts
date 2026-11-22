import { AuditLogEvent, Events } from 'discord.js';
import type { Guild, Client, GuildAuditLogsEntry } from 'discord.js';

type TicketAuditEntry = {
  action: number;
  target?: { parentId?: string | null; parent_id?: string | null; id?: string } | null;
  targetId?: string | null;
  extra?: { channel?: { id?: string; parentId?: string; parent_id?: string } | null; channelId?: string } | null;
  changes?: Array<{ key: string; old?: unknown; new?: unknown }> | null;
};


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

export function isTicketAuditEntry(entry: GuildAuditLogsEntry | null | undefined, guildId: string): boolean {
  const data = entry as unknown as TicketAuditEntry | null | undefined;
  if (!data || !ticketAuditActions.has(data.action as AuditLogEvent)) return false;
  const categories = new Set(Object.values(config.tickets?.typeCategoryIds ?? {}).filter(Boolean));
  const parentIds = [
    data?.target?.parentId,
    data?.target?.parent_id,
    data?.extra?.channel?.parentId,
    data?.extra?.channel?.parent_id,
    ...(data?.changes ?? []).filter(change => change.key === 'parent_id')
      .flatMap(change => [change.old, change.new])
  ];
  if (parentIds.some(id => typeof id === 'string' && categories.has(id))) return true;
  const channelIds = [
    data?.targetId,
    data?.target?.id,
    data?.extra?.channel?.id,
    data?.extra?.channelId
  ].filter(Boolean);
  return channelIds.some(id => Boolean(getTicketByChannel(guildId, String(id))));
}

export const name = Events.GuildAuditLogEntryCreate;
const processed=new Map<string, number>();

export async function execute(entry: GuildAuditLogsEntry, guild: Guild, client: Client): Promise<void>{
  if(!entry||!guild||guild.id!==config.guildId)return;
  const key=entry.id??String(entry.action)+':'+String(entry.createdTimestamp)+':'+String(entry.targetId);
  if(processed.has(key))return;
  processed.set(key,Date.now());
  if(processed.size>700){
    const oldest=[...processed.keys()].slice(0,350);
    for(const id of oldest)processed.delete(id);
  }
  const destination: string=auditDestination(entry,{
    botId:client.user?.id ?? null,
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
    console.error('[audit-events] Could not route audit entry:',entry.id,error instanceof Error ? error.message : String(error));
  }
}
