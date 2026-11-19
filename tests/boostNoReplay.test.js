import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageType } from 'discord.js';

const dir=mkdtempSync(join(tmpdir(),'opus-boost-no-replay-'));
process.env.DB_PATH=join(dir,'boost.sqlite');

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const { processBoostSystemMessage } = await import('../src/services/boosts.js');

function boostMessage(id, options={}){
  const sent=[];
  const target={
    id:config.boosts.channelId,
    isTextBased:()=>true,
    send:async payload=>{
      if(options.failSend)throw new Error('Transient send error');
      sent.push(payload);
      return {id:'announcement-'+id};
    }
  };
  const guild={
    id:config.guildId,
    name:'Opus Client',
    channels:{fetch:async()=>target},
    fetch:async()=>({premiumSubscriptionCount:3})
  };
  let deleted=0;
  const message={
    id,
    guild,
    channelId:config.boosts.channelId,
    type:MessageType.GuildBoost,
    author:{id:'111111111111111111',bot:false,displayAvatarURL:()=>null},
    content:'2',
    createdTimestamp:Date.now(),
    delete:async()=>{deleted++;}
  };
  return {message,sent,getDeleted:()=>deleted};
}

test('restarting bot has no boost backfill or startup posting code',()=>{
  const ready=readFileSync(resolve('src/events/clientReady.js'),'utf8');
  assert.doesNotMatch(ready,/reconcileBoostAnnouncements|processBoostSystemMessage/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boost_announcements').get().n,0);
});

test('new Discord boost event sends exactly one announcement',async()=>{
  const original=boostMessage('boost-001');
  const result=await processBoostSystemMessage(original.message);
  assert.equal(result.posted,true);
  assert.equal(original.sent.length,1);
  assert.equal(original.getDeleted(),1);
  const rows=db.prepare('SELECT source_id,kind,announcement_message_id FROM boost_announcements').all().map(row=>({...row}));
  assert.deepEqual(rows,[{source_id:'boost-001',kind:'live',announcement_message_id:'announcement-boost-001'}]);
  const repeated=boostMessage('boost-001');
  const duplicate=await processBoostSystemMessage(repeated.message);
  assert.equal(duplicate.skipped,'already-recorded');
  assert.equal(repeated.sent.length,0);
  assert.equal(repeated.getDeleted(),1);
});

test('failed boost announcement never repeats automatically and preserves Discord native event',async()=>{
  const failing=boostMessage('boost-002',{failSend:true});
  await assert.rejects(processBoostSystemMessage(failing.message),/Transient send error/);
  assert.equal(failing.getDeleted(),0);
  const reDelivered=boostMessage('boost-002');
  const result=await processBoostSystemMessage(reDelivered.message);
  assert.equal(result.skipped,'already-recorded');
  assert.equal(reDelivered.sent.length,0);
  assert.equal(reDelivered.getDeleted(),0);
});

test('normal messages and messages in other channels are ignored',async()=>{
  const normal=boostMessage('normal');
  normal.message.type=MessageType.Default;
  assert.equal((await processBoostSystemMessage(normal.message)).skipped,'not-boost');
  normal.message.channelId='other-channel';
  normal.message.type=MessageType.GuildBoost;
  assert.equal((await processBoostSystemMessage(normal.message)).skipped,'not-boost');
  assert.equal(normal.sent.length,0);
});

test.after(()=>{
  db.close();
  rmSync(dir,{recursive:true,force:true});
});
