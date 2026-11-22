import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogEvent } from 'discord.js';
import { config } from '../src/config.js';
import { auditDestination, auditActionName, auditChangeLabel, buildGuildAuditEmbed } from '../src/services/guildAuditEvents.js';
import { execute as eventHandler, isTicketAuditEntry } from '../src/events/guildAuditLogEntryCreate.js';
import { execute as automodHandler } from '../src/events/autoModerationActionExecution.js';
import { sendAutoModLog, sendBlacklistLog, logCase } from '../src/services/log.js';

const botId='1567863507775397908';
const actor='123456789012345677';
const target='123456789012345678';
let counter=0;
const entry=(action,changes=[],extra={})=>({
  id:String(123456789012345000n+BigInt(++counter)),
  action,
  executorId:actor,
  targetId:target,
  changes,
  createdTimestamp:Date.now(),
  ...extra
});
const makeGuild=()=>{
  const sent=new Map();
  const channels=[config.auditLogChannelId,config.modLogChannelId,
    config.logChannels.automodChannelId,config.logChannels.blacklistChannelId];
  for(const id of channels)sent.set(id,[]);
  const cache=new Map(channels.map(id=>[id,{
    id,isTextBased:()=>true,
    send:async payload=>{
      sent.get(id).push(payload);
      return {id:'987654321098765432',...payload};
    }
  }]));
  const guild={id:config.guildId,name:'Opus Client',channels:{cache,fetch:async id=>cache.get(id)}};
  return {sent,guild};
};
const count=(sent,id)=>sent.get(id)?.length??0;

test('ticket channel audit events stay in ticket records, not guild configuration audit',async()=>{
  const ticketCategoryId = config.tickets.typeCategoryIds.general;
  const generated = entry(AuditLogEvent.ChannelCreate, [], {
    target: { id: '123456789012345633', parentId: ticketCategoryId }
  });
  assert.equal(isTicketAuditEntry(generated, config.guildId), true);
  assert.equal(isTicketAuditEntry(entry(AuditLogEvent.ChannelCreate, [], {
    target: { id: '123456789012345634', parentId: '123456789012345635' }
  }), config.guildId), false);
  const {guild,sent} = makeGuild();
  await eventHandler(generated, guild, { user: { id: botId } });
  assert.equal(count(sent, config.auditLogChannelId), 0);
});

test('audit action names are human-readable',()=>{
  assert.equal(auditActionName(AuditLogEvent.RoleUpdate),'Role Update');
  assert.equal(auditActionName(AuditLogEvent.ChannelOverwriteUpdate),'Channel Overwrite Update');
});

test('server configuration and security changes route into audit, not moderation',()=>{
  for(const action of [
    AuditLogEvent.GuildUpdate,
    AuditLogEvent.ChannelCreate,AuditLogEvent.ChannelUpdate,AuditLogEvent.ChannelDelete,
    AuditLogEvent.ChannelOverwriteUpdate,AuditLogEvent.RoleCreate,AuditLogEvent.RoleUpdate,
    AuditLogEvent.RoleDelete,AuditLogEvent.MemberRoleUpdate,AuditLogEvent.InviteCreate,
    AuditLogEvent.WebhookDelete,AuditLogEvent.EmojiCreate,AuditLogEvent.ThreadDelete,
    AuditLogEvent.IntegrationUpdate,AuditLogEvent.ApplicationCommandPermissionUpdate,
    AuditLogEvent.BotAdd,AuditLogEvent.AutoModerationRuleUpdate
  ]){
    assert.equal(auditDestination(entry(action),{botId,muteRoleId:config.muteRoleId}),'audit',
      'Unrouted event: '+action);
  }
});

test('direct bans, kicks and timeouts remain moderation events',()=>{
  for(const action of [AuditLogEvent.MemberBanAdd,AuditLogEvent.MemberBanRemove,
    AuditLogEvent.MemberKick]){
    assert.equal(auditDestination(entry(action),{botId}),'moderation');
    assert.equal(auditDestination(entry(action,[],{executorId:botId}),{botId}),'none');
  }
  const timeout=entry(AuditLogEvent.MemberUpdate,[{key:'communication_disabled_until',new:'2026-12-01'}]);
  assert.equal(auditDestination(timeout,{botId}),'moderation');
  assert.equal(auditDestination(entry(AuditLogEvent.MemberUpdate,[{key:'nick',new:'new name'}]),{botId}),'audit');
});

test('manual mute role updates emit only the security record',()=>{
  const muted=entry(AuditLogEvent.MemberRoleUpdate,[{key:'$add',new:[{id:config.muteRoleId,name:'Muted'}]}]);
  assert.equal(auditDestination(muted,{botId,muteRoleId:config.muteRoleId}),'moderation');
  assert.equal(auditDestination({...muted,executorId:botId},{botId,muteRoleId:config.muteRoleId}),'audit');
});

test('message delete/bulk delete do not duplicate existing message gateway logs',()=>{
  for(const action of [AuditLogEvent.MessageDelete,AuditLogEvent.MessageBulkDelete]){
    assert.equal(auditDestination(entry(action),{botId}),'none');
  }
});

test('Discord automod audit entries skip duplicate gateway execution logs',()=>{
  for(const action of [AuditLogEvent.AutoModerationBlockMessage,
    AuditLogEvent.AutoModerationFlagToChannel,
    AuditLogEvent.AutoModerationUserCommunicationDisabled]){
    assert.equal(auditDestination(entry(action),{botId}),'none');
  }
});

test('changes redact sensitive values without exposing secrets or invitations',()=>{
  for(const key of ['token','webhook_url','invite_code','mfa_level','client_secret']){
    const value=auditChangeLabel({key,old:'private-link-123',new:'private-token-456'});
    assert.match(value,/redacted/);
    assert.doesNotMatch(value,/private-link|private-token/);
  }
  assert.match(auditChangeLabel({key:'permissions',old:'0',new:'8'}),/0.*8/);
  assert.match(auditChangeLabel({key:'$remove',new:[{id:config.muteRoleId,name:'Muted'}]}),/Roles removed/);
});

test('audit embeds include actor, target, role changes and reference ID',()=>{
  const sample=entry(AuditLogEvent.MemberRoleUpdate,[{
    key:'$remove',new:[{id:config.muteRoleId,name:'Muted'}]
  }]);
  const data=buildGuildAuditEmbed(sample).toJSON();
  assert.match(data.description,new RegExp(actor));
  assert.match(data.description,new RegExp(target));
  assert.match(data.description,/Roles removed/);
  assert.match(data.footer.text,new RegExp(sample.id));
  assert.ok(data.description.length<4096);
});

test('guild audit gateway event emits one correct channel log per event',async()=>{
  const {guild,sent}=makeGuild();
  const client={user:{id:botId}};
  const roleUpdate=entry(AuditLogEvent.RoleUpdate,[{key:'permissions',old:'0',new:'8'}]);
  await eventHandler(roleUpdate,guild,client);
  await eventHandler(roleUpdate,guild,client);
  assert.equal(count(sent,config.auditLogChannelId),1);
  assert.equal(count(sent,config.modLogChannelId),0);
  assert.equal(count(sent,config.logChannels.automodChannelId),0);
  const mute=entry(AuditLogEvent.MemberRoleUpdate,[{
    key:'$add',new:[{id:config.muteRoleId,name:'Muted'}]
  }]);
  await eventHandler(mute,guild,client);
  assert.equal(count(sent,config.auditLogChannelId),1);
  assert.equal(count(sent,config.modLogChannelId),1);
  assert.deepEqual(sent.get(config.auditLogChannelId)[0].allowedMentions,{parse:[]});
});

test('native automod gateway execution creates a scoped anonymized log card',async()=>{
  const {guild,sent}=makeGuild();
  await automodHandler({
    guildId:config.guildId,guild,userId:target,
    channelId:config.modLogChannelId,ruleId:'123456789012345689',
    action:{type:1},content:'DO NOT PRINT THIS CONTENT'
  });
  assert.equal(count(sent,config.logChannels.automodChannelId),1);
  const serialized=JSON.stringify(sent.get(config.logChannels.automodChannelId)[0].embeds[0].toJSON());
  assert.doesNotMatch(serialized,/DO NOT PRINT THIS CONTENT/);
  assert.match(serialized,new RegExp(target));
});

test('blacklist cases share the security log destination',async()=>{
  const {guild,sent}=makeGuild();
  const caseRow={
    case_number:120,user_id:target,moderator_id:actor,
    type:'blacklisted',status:'active',reason:'Repeated abuse',
    created_at:Date.now()
  };
  await logCase(guild,caseRow,{clientId:botId});
  assert.equal(count(sent,config.logChannels.blacklistChannelId),0);
  assert.equal(count(sent,config.modLogChannelId),1);
});

test('automated enforcement routes separately from human moderation',async()=>{
  const {guild,sent}=makeGuild();
  const base={
    case_number:121,user_id:target,type:'mute',status:'active',
    reason:'Automated threshold',created_at:Date.now()
  };
  await logCase(guild,{...base,moderator_id:botId},{clientId:botId});
  await logCase(guild,{...base,moderator_id:actor},{clientId:botId});
  assert.equal(count(sent,config.modLogChannelId),1);
  assert.equal(count(sent,config.logChannels.automodChannelId),1);
});

test('automod alerts can ping only the configured Moderator role',async()=>{
  const {guild,sent}=makeGuild();
  const mention='<@&'+config.modRoleId+'>';
  const allowedMentions={parse:[],roles:[config.modRoleId]};
  await sendAutoModLog(guild,buildGuildAuditEmbed(entry(AuditLogEvent.AutoModerationRuleUpdate)),{
    content:mention,allowedMentions
  });
  const payload=sent.get(config.logChannels.automodChannelId)[0];
  assert.equal(payload.content,mention);
  assert.deepEqual(payload.allowedMentions,allowedMentions);
});
