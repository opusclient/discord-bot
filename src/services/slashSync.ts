import { config } from '../config.js';
import type { Client, ApplicationCommandData } from 'discord.js';

type ShapeOption = { name: string; type: number; required?: boolean; options?: ShapeOption[] };
type ShapeCommand = { name: string; description?: string; default_member_permissions?: string | null; options?: ShapeOption[] };
type RegistryDifference = { missing: string[]; outdated: string[]; extra: string[] };
type SlashClient = Client & { commands: Map<string, { data: { toJSON(): ApplicationCommandData } }> };


export const commandShape = (command: ShapeCommand) => ({
  name:command.name,
  description:command.description,
  default_member_permissions: command.default_member_permissions ?? null,
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

export function commandDifferences(actual: ShapeCommand[],desired: ShapeCommand[]): RegistryDifference{
  const existing=new Map(actual.map(command=>[command.name,JSON.stringify(commandShape(command))]));
  const expected=new Map(desired.map(command=>[command.name,JSON.stringify(commandShape(command))]));
  return {
    missing:[...expected.keys()].filter(name=>!existing.has(name)),
    outdated:[...expected.keys()].filter(name=>existing.has(name)&&existing.get(name)!==expected.get(name)),
    extra:[...existing.keys()].filter(name=>!expected.has(name))
  };
}

export const registriesMatch = (result: RegistryDifference): boolean =>
  result.missing.length===0&&result.outdated.length===0&&result.extra.length===0;

export async function syncGuildSlashCommands(client: SlashClient){
  const guild=client.guilds.cache.get(config.guildId);
  if(!guild)throw new Error('Configured Discord guild is not in the bot cache');
  const commandData=[...client.commands.values()].map(command=>command.data.toJSON());
  const expected=commandData as ShapeCommand[];
  const current=[...(await guild.commands.fetch()).values()].map(command=>command.toJSON()) as ShapeCommand[];
  const differences=commandDifferences(current,expected);
  if(registriesMatch(differences)){
    return {changed:false,count:current.length,differences};
  }
  await guild.commands.set(commandData);
  const verified=[...(await guild.commands.fetch()).values()].map(command=>command.toJSON()) as ShapeCommand[];
  const remaining=commandDifferences(verified,expected);
  if(!registriesMatch(remaining)){
    throw new Error('Post-registration slash-command mismatch: '+JSON.stringify(remaining));
  }
  return {changed:true,count:verified.length,differences};
}
