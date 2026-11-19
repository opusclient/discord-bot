import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { isTicketStaff, ticketAccessRoleIds } from '../src/services/tickets.js';
import { isModRole, isSeniorModerator, hasModPermission, canModerateMember } from '../src/utils/permissions.js';

const roleSet = ids => ({roles:{cache:{has: id => ids.includes(id)}},permissions:{has:()=>false}});

test('Moderator and Manager retain moderation while Support has none', () => {
  for(const id of config.moderatorRoleIds){
    assert.equal(isModRole(roleSet([id])),true);
  }
  assert.equal(isModRole(roleSet([config.tickets.supportRoleId])),false);
});

test('Support can manage only approved ticket types', () => {
  const support=roleSet([config.tickets.supportRoleId]);
  for(const type of config.tickets.supportTypeKeys){
    assert.equal(isTicketStaff(support,{type}),true,type);
  }
  for(const type of ['appeal','application','security','priority']){
    assert.equal(isTicketStaff(support,{type}),false,type);
  }
  assert.equal(isTicketStaff(support),false);
});

test('Support has channel access only to approved ticket types', () => {
  const map=new Map([config.modRoleId,config.tickets.staffRoleId,...config.tickets.staffRoleIds,config.tickets.supportRoleId].filter(Boolean).map(id=>[id,{managed:false}]));
  const guild={roles:{cache:map}};
  assert.equal(ticketAccessRoleIds(guild,'general').includes(config.tickets.supportRoleId),true);
  assert.equal(ticketAccessRoleIds(guild,'application').includes(config.tickets.supportRoleId),false);
  assert.equal(ticketAccessRoleIds(guild,'security').includes(config.tickets.supportRoleId),false);
  assert.equal(ticketAccessRoleIds(guild).includes(config.tickets.supportRoleId),false);
});

test('Manager and Principal Engineer can run restricted moderation commands without global permissions', () => {
  for (const id of config.seniorModeratorRoleIds) {
    const member=roleSet([id]);
    assert.equal(isSeniorModerator(member),true);
    assert.equal(hasModPermission(member,1n,{modRoleAllowed:false}),true);
  }
  const regularMod=roleSet([config.modRoleId]);
  assert.equal(hasModPermission(regularMod,1n,{modRoleAllowed:true}),true);
  assert.equal(hasModPermission(regularMod,1n,{modRoleAllowed:false}),false);
  assert.equal(hasModPermission(roleSet([config.tickets.supportRoleId]),1n,{modRoleAllowed:false}),false);
});

test('Principal Engineer cannot moderate a higher-ranking Manager through bot permissions', async () => {
  const member={id:'123456789012345678',roles:{highest:{position:20}}};
  const sent=[];
  const interaction={
    user:{id:'123456789012345679'},
    member:{roles:{highest:{position:19}}},
    guild:{ownerId:'123456789012345680',members:{me:{id:'123456789012345681',roles:{highest:{position:22}}}}},
    replied:false,deferred:false,
    reply:async payload=>sent.push(payload)
  };
  assert.equal(await canModerateMember(interaction,member),false);
  assert.equal(sent.length,1);
  member.roles.highest.position=18;
  assert.equal(await canModerateMember(interaction,member),true);
});
