import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'opus-slash-only-'));
process.env.DB_PATH=join(dir,'slash.sqlite');

const { config }=await import('../src/config.js');
const { execute }=await import('../src/events/messageCreate.js');
const { buildMutedCmdsNotice }=await import('../src/services/install.js');
const { db }=await import('../src/db.js');

test('legacy prefix messages no longer dispatch commands',async()=>{
  const source=readFileSync(resolve('src/events/messageCreate.js'),'utf8');
  assert.doesNotMatch(source,/handlePrefixCommand|prefix\/handler|config\.prefix/);
  const sent=[];
  const client={user:{id:'123456789012345670'}};
  for(const content of ['=help','=ban 123456789012345671','=mute 123456789012345671','!help']){
    const message={
      guild:{id:config.guildId},
      author:{id:'123456789012345671',bot:false},
      content,
      channelId:'123456789012345672',
      channel:{isThread:()=>false},
      reply:async data=>{sent.push(data);},
      delete:async()=>{throw Error('Unexpected deletion');}
    };
    await execute(message,client);
  }
  assert.equal(sent.length,0);
});

test('muted-commands notice recommends only slash commands',()=>{
  const embed=buildMutedCmdsNotice({name:'Opus Client'}).embeds[0].toJSON();
  assert.match(embed.description,/\/punishments/);
  assert.match(embed.description,/\/help/);
  assert.doesNotMatch(embed.description,/=help|=puns|prefix commands/i);
});

test('message events needed for boost and closed tickets remain registered',()=>{
  const source=readFileSync(resolve('src/events/messageCreate.js'),'utf8');
  assert.match(source,/processBoostSystemMessage/);
  assert.match(source,/handleDoNotType/);
  assert.match(source,/getTicketByChannel/);
});

test.after(()=>{
  db.close();
  rmSync(dir,{recursive:true,force:true});
});
