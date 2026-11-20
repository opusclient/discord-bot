import { REST, Routes } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertConfig, config } from './config.js';
import { loadModuleCommands } from './modules/registry.js';

assertConfig({requireGuild:true});

const root = path.dirname(fileURLToPath(import.meta.url));
const commands = await loadModuleCommands(new Map());
const desired = [...commands.values()].map(command => command.data.toJSON());
const rest = new REST({version:'10'}).setToken(config.token);

const shape = command => ({
  name:command.name,
  description:command.description,
  options:(command.options??[]).map(option=>({
    name:option.name,
    type:option.type,
    required:!!option.required,
    options:(option.options??[]).map(sub=>({
      name:sub.name,
      type:sub.type,
      required:!!sub.required
    }))
  }))
});

const signatures = commands => new Map(commands.map(command=>[command.name,JSON.stringify(shape(command))]));

const diff = (actual,expected) => {
  const left=signatures(actual);
  const right=signatures(expected);
  return {
    missing:[...right.keys()].filter(key=>!left.has(key)),
    outdated:[...right.keys()].filter(key=>left.has(key)&&left.get(key)!==right.get(key)),
    extra:[...left.keys()].filter(key=>!right.has(key))
  };
};

const empty = result => !result.missing.length&&!result.outdated.length&&!result.extra.length;

async function readRemote(){
  const [global,guild] = await Promise.all([
    rest.get(Routes.applicationCommands(config.clientId)),
    rest.get(Routes.applicationGuildCommands(config.clientId,config.guildId))
  ]);
  return {global,guild};
}

try {
  const self = await rest.get(Routes.user('@me'));
  if(!self.bot || self.id!==config.clientId){
    throw new Error('Token belongs to a different Discord application');
  }
  const current=await readRemote();
  console.log(JSON.stringify({
    stage:'audit',guildId:config.guildId,expected:desired.length,
    guild:current.guild.length,global:current.global.length,
    guildDifferences:diff(current.guild,desired),
    globalCommandNames:current.global.map(command=>command.name)
  }));

  if(process.argv.includes('--check'))process.exit(0);

  const dir=path.join(root,'../data/backups');
  await mkdir(dir,{recursive:true});
  const backup=path.join(dir,'slash-commands-before-migration-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  await writeFile(backup,JSON.stringify({
    guildId:config.guildId,applicationId:config.clientId,
    previousGuild:current.guild,previousGlobal:current.global,
    desired
  },null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({stage:'backup',path:backup}));

  await rest.put(Routes.applicationGuildCommands(config.clientId,config.guildId),{body:desired});
  const staged=await readRemote();
  const guildDiff=diff(staged.guild,desired);
  if(!empty(guildDiff)){
    throw new Error('Guild slash command verification failed: '+JSON.stringify(guildDiff));
  }
  console.log(JSON.stringify({stage:'guild-updated',count:staged.guild.length}));

  if(staged.global.length){
    await rest.put(Routes.applicationCommands(config.clientId),{body:[]});
  }

  const final=await readRemote();
  const differences=diff(final.guild,desired);
  const complete=empty(differences)&&final.global.length===0;
  console.log(JSON.stringify({
    stage:'verified',complete,
    guildId:config.guildId,
    guildCount:final.guild.length,
    globalCount:final.global.length,
    differences,
    names:final.guild.map(command=>command.name).sort()
  }));
  if(!complete)process.exitCode=2;
}catch(error){
  console.error('[slash-deploy]',error.message);
  process.exitCode=1;
}
