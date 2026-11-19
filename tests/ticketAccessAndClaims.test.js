import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OverwriteType, PermissionsBitField, MessageFlags } from 'discord.js';

const dir=mkdtempSync(join(tmpdir(),'opus-ticket-acl-'));
process.env.DB_PATH=join(dir,'ticket.sqlite');
const { db, createTicketRow, getTicketByChannel, claimTicketRow }=await import('../src/db.js');
const { config }=await import('../src/config.js');
const { removeFromTicket, addToTicket }=await import('../src/services/tickets.js');
const { execute: claimExecute }=await import('../src/commands/claim.js');
const { execute: unclaimExecute }=await import('../src/commands/unclaim.js');

const userId='123456789012345672';
const staffId='123456789012345673';
const ownerId='123456789012345674';
const botId='123456789012345675';
const channelId='123456789012345676';
const devId=config.roleBranches.developer;
const modId=config.tickets.staffRoleId;
const View=PermissionsBitField.Flags.ViewChannel;

function buildGuild({initial=[],memberRoles=[devId,modId]}={}){
  const map=new Map();
  const events=[];
  const stub=members=>({id:members,managed:false});
  const roles=new Map([[devId,stub(devId)],[modId,stub(modId)]]);
  const overwrite={
    cache:map,
    async edit(id,flags,options={}){
      events.push(['edit',id,options.type,flags]);
      const previous=map.get(id);
      let allow=previous?.allow.bitfield??0n;
      let deny=previous?.deny.bitfield??0n;
      for(const [name,value] of Object.entries(flags)){
        const flag=PermissionsBitField.Flags[name];
        if(!flag)continue;
        if(value===true){allow|=flag;deny&=~flag;}
        if(value===false){deny|=flag;allow&=~flag;}
      }
      map.set(id,{id,type:options.type,allow:new PermissionsBitField(allow),deny:new PermissionsBitField(deny)});
      return channel;
    },
    async delete(id){
      events.push(['delete',id]);
      map.delete(id);
      return channel;
    }
  };
  const messages=[];
  const channel={
    id:channelId,
    permissionOverwrites:overwrite,
    isTextBased:()=>true,
    send:async payload=>{messages.push(payload);return payload;}
  };
  const members={
    me:{id:botId},
    fetch:async id=>id===userId?target:null
  };
  const guild={
    id:config.guildId,ownerId,roles:{cache:roles,everyone:{id:config.guildId}},
    members,
    channels:{fetch:async id=>id===channelId?channel:null}
  };
  const target={
    id:userId,permissions:{has:()=>false},
    roles:{cache:new Map(memberRoles.map(id=>[id,roles.get(id)]))}
  };
  for(const entry of initial){
    map.set(entry.id,{
      id:entry.id,
      type:entry.type??OverwriteType.Role,
      allow:new PermissionsBitField(entry.allow??0n),
      deny:new PermissionsBitField(entry.deny??0n)
    });
  }
  const sees=(member=target)=>{
    if(member.permissions?.has?.(PermissionsBitField.Flags.Administrator))return true;
    const direct=map.get(member.id);
    if(direct?.deny.has(View))return false;
    if(direct?.allow.has(View))return true;
    return [...member.roles.cache.keys()].some(id=>map.get(id)?.allow.has(View));
  };
  return {guild,channel,map,events,messages,target,sees};
}

const ticket={id:10,channel_id:channelId,owner_id:ownerId,type:'general'};
const actor={id:staffId};

test('removing user denies access even when Developer and Moderator both grant it',async()=>{
  const fixture=buildGuild({initial:[
    {id:devId,allow:View},
    {id:modId,allow:View}
  ]});
  assert.equal(fixture.sees(),true);
  const removed=await removeFromTicket(fixture.guild,ticket,fixture.target,actor);
  assert.equal(removed.error,undefined);
  assert.equal(fixture.sees(),false);
  assert.equal(fixture.map.get(userId).type,OverwriteType.Member);
  assert.equal(fixture.map.get(devId).allow.has(View),true);
  assert.equal(fixture.map.get(modId).allow.has(View),true);
  assert.equal(fixture.events.at(-1)[1],userId);
  const added=await addToTicket(fixture.guild,ticket,fixture.target,actor);
  assert.equal(added.error,undefined);
  assert.equal(fixture.sees(),true);
  assert.equal(fixture.map.get(userId).deny.has(View),false);
});

test('removing Developer role preserves Moderator access without adding member deny',async()=>{
  const fixture=buildGuild({initial:[
    {id:devId,allow:View},
    {id:modId,allow:View}
  ]});
  const role=fixture.guild.roles.cache.get(devId);
  const removed=await removeFromTicket(fixture.guild,ticket,role,actor);
  assert.equal(removed.error,undefined);
  assert.equal(fixture.map.has(devId),false);
  assert.equal(fixture.map.get(modId).allow.has(View),true);
  assert.equal(fixture.sees(),true);
  assert.equal(fixture.map.has(userId),false);
});

test('removing Developer re-applies missing Moderator overwrite on legacy ticket',async()=>{
  const fixture=buildGuild({initial:[{id:devId,allow:View}]});
  assert.equal(fixture.sees(),true);
  const removed=await removeFromTicket(fixture.guild,ticket,fixture.guild.roles.cache.get(devId),actor);
  assert.equal(removed.error,undefined);
  assert.equal(fixture.sees(),true);
  assert.equal(fixture.map.get(modId).allow.has(View),true);
  assert.equal(fixture.map.has(devId),false);
});

test('explicit user removal stays blocked when unrelated role is subsequently removed',async()=>{
  const fixture=buildGuild({initial:[{id:devId,allow:View},{id:modId,allow:View}]});
  await removeFromTicket(fixture.guild,ticket,fixture.target,actor);
  await removeFromTicket(fixture.guild,ticket,fixture.guild.roles.cache.get(devId),actor);
  assert.equal(fixture.sees(),false);
  await addToTicket(fixture.guild,ticket,fixture.target,actor);
  assert.equal(fixture.sees(),true);
});

test('user-specific exclusion rejects owner and Administrator',async()=>{
  const fixture=buildGuild({initial:[{id:devId,allow:View}]});
  assert.match((await removeFromTicket(fixture.guild,ticket,{id:ownerId},actor)).error,/owner/);
  assert.match((await removeFromTicket(fixture.guild,ticket,{id:userId,permissions:{has:()=>true}},actor)).error,/Administrators/);
  assert.equal(fixture.map.has(userId),false);
});

const opened=createTicketRow({
  guildId:config.guildId,channelId,ownerId,type:'general',purpose:'Claim lifecycle test'
});

function makeClaimInteraction(command, {channel=channelId,staff=true,hide=false}={}){
  const replies=[];
  const guild={
    id:config.guildId,
    channels:{fetch:async id=>id===channelId?{isTextBased:()=>true,send:async()=>({})}:null}
  };
  const interaction={
    guildId:config.guildId,channelId:channel,guild,
    user:{id:staffId},
    member:{
      id:staffId,
      permissions:{has:()=>false},
      roles:{cache:new Map(staff?[[modId,{id:modId}]]:[])}
    },
    options:{getBoolean:()=>hide},
    deferReply:async payload=>{replies.push(['defer',payload]);},
    editReply:async payload=>{replies.push(['edit',payload]);},
    reply:async payload=>{replies.push(['reply',payload]);}
  };
  const client={user:{id:botId},guilds:{cache:new Map()}};
  return {interaction,client,replies,run:()=>command(interaction,client)};
}

test('claim/unclaim only operate inside active tickets',async()=>{
  const c=makeClaimInteraction(claimExecute,{channel:'123456789012345699'});
  await c.run();
  assert.deepEqual(c.replies.map(x=>x[0]),['reply']);
  assert.match(JSON.stringify(c.replies),/not an open ticket/);
  assert.equal(getTicketByChannel(config.guildId,channelId).claimed_by,null);
});

test('claim and unclaim are separate idempotent actions and owner-only release',async()=>{
  const c=makeClaimInteraction(claimExecute);
  const u=makeClaimInteraction(unclaimExecute);
  await u.run();
  assert.match(JSON.stringify(u.replies),/not currently claimed/);
  await c.run();
  assert.equal(getTicketByChannel(config.guildId,channelId).claimed_by,staffId);
  await c.run();
  assert.match(JSON.stringify(c.replies.at(-1)),/already claimed/);
  assert.equal(getTicketByChannel(config.guildId,channelId).claimed_by,staffId);
  await u.run();
  assert.equal(getTicketByChannel(config.guildId,channelId).claimed_by,null);
  await u.run();
  assert.match(JSON.stringify(u.replies.at(-1)),/not currently claimed/);
  assert.equal(claimTicketRow(opened.id,'123456789012345688','unclaim').error!==undefined,true);
});

test('nonstaff cannot claim and hide remains supported',async()=>{
  const denied=makeClaimInteraction(claimExecute,{staff:false});
  await denied.run();
  assert.match(JSON.stringify(denied.replies),/Only ticket staff/);
  const privateCall=makeClaimInteraction(claimExecute,{hide:true});
  await privateCall.run();
  assert.equal(privateCall.replies[0][1].flags,MessageFlags.Ephemeral);
  assert.equal(getTicketByChannel(config.guildId,channelId).claimed_by,staffId);
  await makeClaimInteraction(unclaimExecute).run();
});

test.after(()=>{
  db.close();
  rmSync(dir,{recursive:true,force:true});
});
