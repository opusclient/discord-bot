import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client, ClientEvents } from 'discord.js';
import { installHideOption } from './visibility.js';

export type SlashCommandModule = {
  data: {
    name: string;
    toJSON(): unknown;
  };
  execute: (...args: unknown[]) => unknown;
};

export type EventModule = {
  name: string;
  once?: boolean;
  execute: (...args: unknown[]) => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCommand(value: unknown): value is SlashCommandModule {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return typeof data.name === 'string'
    && typeof data.toJSON === 'function'
    && typeof value.execute === 'function';
}

function isEvent(value: unknown): value is EventModule {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.execute === 'function';
}

function walk(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(full);
    }
  }
  return output;
}

export async function loadCommands(
  dir: string,
  collection: Map<string, SlashCommandModule>
): Promise<Map<string, SlashCommandModule>> {
  for (const file of walk(dir)) {
    const mod: unknown = await import(pathToFileURL(file).href);
    if (isCommand(mod)) {
      if (collection.has(mod.data.name)) {
        throw new Error('Duplicate slash command: ' + mod.data.name + ' in ' + file);
      }
      installHideOption(mod.data);
      collection.set(mod.data.name, mod);
    } else {
      console.warn(`[loader] Skipping ${file}: missing data/execute export`);
    }
  }
  return collection;
}

export async function loadEvents(client: Client, dir: string): Promise<void> {
  for (const file of walk(dir)) {
    const mod: unknown = await import(pathToFileURL(file).href);
    if (!isEvent(mod)) {
      console.warn(`[loader] Skipping ${file}: missing name/execute export`);
      continue;
    }
    const handler = (...args: unknown[]) => mod.execute(...args, client);
    if (mod.once) client.once(mod.name as keyof ClientEvents, handler);
    else client.on(mod.name as keyof ClientEvents, handler);
  }
}
