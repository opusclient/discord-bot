import { Events } from 'discord.js';
import { config } from '../config.js';
import { sendAuditLog } from '../services/auditlog.js';
import { sendAutoModLog, sendModLog } from '../services/log.js';
import { auditDestination, buildGuildAuditEmbed } from '../services/guildAuditEvents.js';

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
  if(destination==='none')return;
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
