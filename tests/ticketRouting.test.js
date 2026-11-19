import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType, PermissionsBitField } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'opus-ticket-routing-'));
process.env.DB_PATH = join(dir, 'tickets.sqlite');

const { config } = await import('../src/config.js');
const { db, getTicketStats, getTicketByChannel } = await import('../src/db.js');
const { TICKET_TYPES, formatTicketChannelName, openTicket, renameTicket, closeTicket } = await import('../src/services/tickets.js');

test('ticket names retain the global numeric prefix', () => {
  assert.equal(formatTicketChannelName(2, 'zvwgvx'), '0002-zvwgvx');
  assert.equal(formatTicketChannelName(140, 'A Cool Name'), '0140-a-cool-name');
  assert.equal(formatTicketChannelName(10001, 'AB'), '10001-ab');
  assert.ok(formatTicketChannelName(8, 'A'.repeat(200)).length <= 100);
  assert.throws(() => formatTicketChannelName(0, 'bad'), /Invalid ticket number/);
});

test('all ticket types use one numbering sequence and required transcript storage', async () => {
  const guildId = config.guildId;
  const ownerId = '123456789012345681';
  const otherId = '123456789012345682';
  const staffId = '123456789012345683';
  const oldId = '123456789012345684';
  db.prepare('INSERT INTO tickets (guild_id, channel_id, owner_id, type, status, ticket_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(guildId, oldId, ownerId, 'application', 'closed', 1, Date.now());

  const actual = new Map();
  const categories = new Map(Object.entries(config.tickets.typeCategoryIds).map(([key,id]) =>
    [id, {id, name: '[ TICKETS - ' + key + ' ]', type: ChannelType.GuildCategory}]));
  const logs = [];
  let logUnavailable = false;
  let nextId = 123456789012345690n;
  const logChannel = {
    isTextBased: () => true,
    send: async payload => {
      if (logUnavailable) throw new Error('simulated log outage');
      logs.push(payload);
      return {id:String(nextId++)};
    },
  };
  const roleCache = new Map(
    [config.tickets.staffRoleId, ...config.tickets.staffRoleIds].map(id=>[id,{id,managed:false}])
  );
  const guild = {
    id:guildId,
    iconURL: () => null,
    roles:{everyone:{id:guildId},cache:roleCache},
    members:{
      me:{permissions:{has: flag => flag===PermissionsBitField.Flags.ManageChannels}},
      fetch: async id=>({id}),
    },
    channels:{
      cache:new Map(),
      fetch:async id=>{
        if(id===config.tickets.logChannelId)return logChannel;
        return categories.get(id) ?? actual.get(id) ?? null;
      },
      create:async opts=>{
        const id = String(nextId++);
        const sends=[];
        const channel={
          id,name:opts.name,parentId:opts.parent,topic:null,
          isTextBased:()=>true,
          permissionOverwrites:{edit:async()=>true},
          messages:{fetch:async()=>new Collection()},
          send:async payload=>{sends.push(payload);return {id:String(nextId++)};},
          setName:async next=>{channel.name=next;return channel;},
          delete:async()=>{actual.delete(id);channel.deleted=true;},
          sends,deleted:false,
        };
        actual.set(id,channel);
        return channel;
      }
    },
  };
  const client = {user:{id:'123456789012345685'},guilds:{cache:new Map([[guildId,guild]])}};
  const interaction = userId=>({guild,user:{id:userId,username:'zvwgvx'}});
  const priority = await openTicket(interaction(ownerId),client,'priority','A serious login bug needs attention');
  assert.ok(priority.channel);
  assert.equal(priority.channel.name,'0002-zvwgvx');
  assert.equal(priority.channel.parentId,config.tickets.typeCategoryIds.priority);
  assert.equal(priority.ticket.ticket_number,2);
  const duplicate = await openTicket(interaction(ownerId),client,'priority','Another urgent support request');
  assert.match(duplicate.error,/already have an open/i);

  const general = await openTicket(interaction(otherId),client,'general','General support question about the client');
  assert.ok(general.channel);
  assert.equal(general.channel.name,'0003-zvwgvx');
  assert.equal(general.channel.parentId,config.tickets.typeCategoryIds.general);
  assert.equal(general.ticket.ticket_number,3);
  assert.deepEqual(getTicketStats(guildId),{open:2,claimed:0,closed:1});

  const renamed = await renameTicket(guild,priority.ticket,'new-title',{id:staffId});
  assert.equal(renamed.channel.name,'0002-new-title');
  assert.equal(formatTicketChannelName(priority.ticket.ticket_number,'zvwgvx'),'0002-zvwgvx');

  const staff = {id:staffId};
  logUnavailable=true;
  const failed = await closeTicket(guild,priority.ticket,staff,null,client);
  assert.match(failed.error,/remains open/);
  assert.equal(priority.channel.deleted,false);
  assert.equal(getTicketByChannel(guildId,priority.channel.id).status,'open');
  logUnavailable=false;

  const closed=await closeTicket(guild,priority.ticket,staff,'Resolved',client);
  assert.equal(closed.closed,true);
  assert.equal(priority.channel.deleted,true);
  assert.equal(logs.length,1);
  assert.equal(logs[0].files.length,1);
  assert.equal(logs[0].embeds[0].data.footer.text,'Ticket #0002');
  assert.deepEqual(getTicketStats(guildId),{open:1,claimed:0,closed:2});
  const generalClosed = await closeTicket(guild,general.ticket,staff,null,client);
  assert.equal(generalClosed.closed,true);
  assert.equal(logs.length,2);
  assert.equal(logs[1].embeds[0].data.footer.text,'Ticket #0003');
  assert.deepEqual(getTicketStats(guildId),{open:0,claimed:0,closed:3});
});

test.after(()=>{
  db.close();
  rmSync(dir,{recursive:true,force:true});
});
