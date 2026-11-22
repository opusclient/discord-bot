import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageType } from 'discord.js';
import { buildBoostEmbed, isBoostSystemMessage, parseDiscordBoostCount } from '../src/services/boostFormat.js';

const channelId = '1571921382898536558';

test('recognizes native Discord boost messages only in the configured channel', () => {
  for(const type of [MessageType.GuildBoost,MessageType.GuildBoostTier1,MessageType.GuildBoostTier2,MessageType.GuildBoostTier3]){
    assert.equal(isBoostSystemMessage({guild:{id:'g'},channelId,type,author:{id:'1',bot:false}},channelId),true);
  }
  assert.equal(isBoostSystemMessage({guild:{id:'g'},channelId:'another',type:MessageType.GuildBoost,author:{id:'1',bot:false}},channelId),false);
  assert.equal(isBoostSystemMessage({guild:{id:'g'},channelId,type:MessageType.Default,author:{id:'1',bot:false}},channelId),false);
  assert.equal(isBoostSystemMessage({guild:{id:'g'},channelId,type:MessageType.GuildBoost,author:{id:'1',bot:true}},channelId),false);
});

test('counts are only read from numeric Discord notices',()=>{
  assert.equal(parseDiscordBoostCount('2'),2);
  assert.equal(parseDiscordBoostCount(''),null);
  assert.equal(parseDiscordBoostCount('just boosted'),null);
  assert.equal(parseDiscordBoostCount('0'),null);
});

test('historical acknowledgement does not invent per-member boost counts',()=>{
  const embed=buildBoostEmbed({guildName:'Opus Client',userId:'1320303839701897230',historical:true,premiumSince:1794844636714,totalBoosts:3}).toJSON();
  assert.match(embed.description,/<@1320303839701897230>/);
  assert.ok(embed.fields.some(f=>f.name==='Current Server Boosts'&&f.value==='3'));
  assert.ok(!embed.fields.some(f=>f.name.includes('Discord Notice')));
  assert.equal(embed.title,'Thank You for Boosting Our Discord Server!');
  assert.match(embed.description,/Opus Client Discord server/);
  assert.doesNotMatch(embed.description,/supporting Opus Client|helping Opus Client grow/);
});

test('live acknowledgement can show Discord native notice count',()=>{
  const embed=buildBoostEmbed({guildName:'Opus Client',userId:'702322601321824286',noticeCount:2,totalBoosts:4}).toJSON();
  assert.equal(embed.title,'New Discord Server Boost!');
  assert.match(embed.description,/Discord server/);
  assert.ok(embed.fields.some(f=>f.name==='Boosts (Discord Notice)'&&f.value==='2'));
});

test('historical boost sequences are shown without invented boost timestamps',()=>{
  const first=buildBoostEmbed({guildName:'Opus Client',userId:'702322601321824286',historical:true,historicalNumber:1,historicalTotal:2,totalBoosts:3}).toJSON();
  const second=buildBoostEmbed({guildName:'Opus Client',userId:'702322601321824286',historical:true,historicalNumber:2,historicalTotal:2,totalBoosts:3}).toJSON();
  assert.equal(first.fields.find(f=>f.name==='Boost')?.value,'1 of 2');
  assert.equal(second.fields.find(f=>f.name==='Boost')?.value,'2 of 2');
  assert.equal(first.timestamp,undefined);
  assert.equal(second.timestamp,undefined);
  assert.equal(first.footer.text,'Opus Client • Discord Server Boosts');
});
