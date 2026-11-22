import { AuditLogEvent, escapeMarkdown } from 'discord.js';
import type { GuildAuditLogsEntry } from 'discord.js';

type AuditChange = { key: string; old?: unknown; new?: unknown };
type AuditEntry = GuildAuditLogsEntry & { changes?: AuditChange[] };
type AuditDestinationOptions = { botId?: string | null; muteRoleId?: string | null };
type AuditEmbedOptions = { category?: 'audit' | 'moderation' | 'automod'; guildName?: string };

import { COLORS } from '../constants.js';
import { baseEmbed } from '../utils/embeds.js';

const moderationActions=new Set([
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberPrune
]);
const messageGatewayActions=new Set([
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete
]);
const automaticActions=new Set([
  AuditLogEvent.AutoModerationBlockMessage,
  AuditLogEvent.AutoModerationFlagToChannel,
  AuditLogEvent.AutoModerationUserCommunicationDisabled,
  AuditLogEvent.AutoModerationQuarantineUser
]);
const excludedChanges=new Set([
  'token','secret','code','url','webhook_url','mfa_level','vanity_url_code',
  'integration_id','discovery_splash','splash','banner','icon_hash'
]);
const tick=String.fromCharCode(96);
const short=(value: unknown,length: number=280): string=>String(value??'Unknown').replace(/[\r\n]/g,' ').slice(0,length);
const markdown=(value: unknown,length: number=280): string=>escapeMarkdown(short(value,length));
const idLabel=(id: unknown,type: string='unknown'): string=>{
  if(!id)return 'Not supplied by Discord';
  if(!/^\d{17,20}$/.test(String(id)))return markdown(id,64);
  if(type==='member')return '<@'+id+'>';
  if(type==='role')return '<@&'+id+'>';
  if(type==='channel')return '<#'+id+'>';
  return tick+id+tick;
};
const targetType=(action: number): string=>{
  if([AuditLogEvent.MemberKick,AuditLogEvent.MemberPrune,AuditLogEvent.MemberBanAdd,
    AuditLogEvent.MemberBanRemove,AuditLogEvent.MemberUpdate,AuditLogEvent.MemberRoleUpdate,
    AuditLogEvent.MemberMove,AuditLogEvent.MemberDisconnect,
    AuditLogEvent.BotAdd].includes(action))return 'member';
  if([AuditLogEvent.RoleCreate,AuditLogEvent.RoleUpdate,AuditLogEvent.RoleDelete].includes(action))return 'role';
  if([AuditLogEvent.ChannelCreate,AuditLogEvent.ChannelUpdate,AuditLogEvent.ChannelDelete,
    AuditLogEvent.ChannelOverwriteCreate,AuditLogEvent.ChannelOverwriteUpdate,
    AuditLogEvent.ChannelOverwriteDelete,AuditLogEvent.ThreadCreate,
    AuditLogEvent.ThreadUpdate,AuditLogEvent.ThreadDelete,
    AuditLogEvent.MessagePin,AuditLogEvent.MessageUnpin].includes(action))return 'channel';
  return 'unknown';
};
const enumActions=new Map<number, string>(Object.entries(AuditLogEvent)
  .filter(([,value])=>typeof value==='number')
  .map(([key,value])=>[value as number,key]));
const humanize=(str: string): string=>str.replace(/([a-z])([A-Z])/g,'$1 $2');

export function auditActionName(action: number): string{
  return enumActions.has(action) ? humanize(enumActions.get(action) ?? '') : 'Discord Audit Event ' + String(action);
}

export function auditDestination(entry: AuditEntry | null | undefined, {botId=null,muteRoleId=null}: AuditDestinationOptions={}){
  if(!entry||typeof entry.action!=='number')return 'none';
  if(messageGatewayActions.has(entry.action))return 'none';
  if(automaticActions.has(entry.action))return 'none';
  if(moderationActions.has(entry.action))return entry.executorId===botId?'none':'moderation';
  if(entry.action===AuditLogEvent.MemberUpdate &&
    (entry.changes??[]).some(c=>c.key==='communication_disabled_until')){
    return entry.executorId===botId?'none':'moderation';
  }
  if(entry.action===AuditLogEvent.MemberRoleUpdate &&
    entry.executorId!==botId &&
    (entry.changes??[]).some(c=>(c.key==='$add'||c.key==='$remove')&&
       Array.isArray(c.new)&&c.new.some(r=>r.id===muteRoleId))){
    return 'moderation';
  }
  return 'audit';
}

export function auditChangeLabel(change: AuditChange): string{
  const key=String(change?.key??'unknown').replace(/[^a-z0-9_$-]/gi,'');
  const name=key.replace(/^[$_]+/,'').replaceAll('_',' ');
  if(excludedChanges.has(key.toLowerCase()) ||
     /token|secret|password|webhook|invite|code/i.test(key)){
    return '**'+markdown(name,50)+':** [redacted]';
  }
  if(key==='$add'||key==='$remove'){
    const roles=Array.isArray(change.new)?change.new:[];
    const formatted=roles.slice(0,7).map(item=>item?.id?
      idLabel(item.id,'role'):tick+markdown(item?.name??'unknown',50)+tick);
    return '**Roles '+(key==='$add'?'added':'removed')+':** '+
      (formatted.join(', ')||'None')+(roles.length>7?' and '+(roles.length-7)+' more':'');
  }
  const display=(value: unknown): string=>{
    if(value===undefined||value===null)return 'none';
    if(typeof value==='boolean')return value?'enabled':'disabled';
    if(typeof value==='string'||typeof value==='number')return markdown(value,120);
    if(Array.isArray(value))return '['+value.length+' items]';
    if(typeof value==='object'){
      const info = value as { name?: unknown; id?: unknown };
      if(typeof info.name==='string')return markdown(info.name,80);
      if(info.id)return idLabel(info.id);
      return '[structured data]';
    }
    return '[changed]';
  };
  return '**'+markdown(name,55)+':** '+display(change.old)+' → '+display(change.new);
}

export function buildGuildAuditEmbed(entry: AuditEntry, {category='audit',guildName='Opus Client'}: AuditEmbedOptions={}){
  const action=auditActionName(entry.action);
  const actor=entry.executorId?idLabel(entry.executorId,'member'):'Unknown';
  const target=idLabel(entry.targetId,targetType(entry.action));
  const reason=entry.reason?'**Reason:** '+markdown(entry.reason,480):null;
  const changes=(entry.changes??[]).slice(0,8).map(auditChangeLabel);
  const otherChanges=(entry.changes?.length??0)-changes.length;
  const meta=category==='moderation'?'MODERATION / DIRECT DISCORD ACTION':
    category==='automod'?'AUTOMOD / DISCORD RULE':'SERVER / CONFIGURATION AUDIT';
  const extra = entry.extra as { channel?: { id?: string }; channelId?: string } | null | undefined;
  const embed=baseEmbed(category==='moderation'?COLORS.warn:
    category==='automod'?COLORS.mute:COLORS.audit)
    .setAuthor({name:'OPUS CLIENT  /  '+meta})
    .setTitle(action)
    .setDescription([
      '**Actor:** '+actor,
      '**Target:** '+target,
      ...((extra?.channel?.id||extra?.channelId)?
        ['**Channel:** '+idLabel(extra?.channel?.id??extra?.channelId,'channel')]:[]),
      reason,
      changes.length?'**Changes**\n'+changes.join('\n'):null,
      otherChanges>0?'…and '+otherChanges+' other change(s)':null
    ].filter(Boolean).join('\n\n').slice(0,3950))
    .setFooter({text:short(guildName,80)+'  ·  Audit ID: '+(entry.id??'unknown')});
  if(Number.isFinite(entry.createdTimestamp))embed.setTimestamp(entry.createdTimestamp);
  else embed.setTimestamp(Date.now());
  return embed;
}
