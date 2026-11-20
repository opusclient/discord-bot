import { fileURLToPath } from 'node:url';
import { installHideOption } from '../utils/visibility.js';
import { manifest as oai } from './oai/index.js';
import { manifest as management } from './management/index.js';
import { manifest as moderation } from './moderation/index.js';
import { manifest as verification } from './verification/index.js';
import { manifest as tickets } from './tickets/index.js';
import { manifest as community } from './community/index.js';
import { manifest as communications } from './communications/index.js';
import { manifest as observability } from './observability/index.js';
import { manifest as integrations } from './integrations/index.js';
import { manifest as operations } from './operations/index.js';

export const moduleCatalog = Object.freeze([
  oai, management, moderation, verification, tickets,
  community, communications, observability, integrations, operations
]);

export function resolveModuleCommandPath(name) {
  const owner = moduleCatalog.find(module => module.commands.includes(name));
  if (!owner) throw new Error('Unassigned Opus System command: ' + name);
  return fileURLToPath(new URL('./' + owner.id + '/commands/' + name + '.js', import.meta.url));
}

export function validateModuleCatalog() {
  const moduleIds = new Set();
  const commandNames = new Set();
  const report = [];
  for (const module of moduleCatalog) {
    if (moduleIds.has(module.id)) throw new Error('Duplicate Opus System module: ' + module.id);
    moduleIds.add(module.id);
    for (const name of module.commands) {
      if (commandNames.has(name)) throw new Error('Duplicate command ownership: ' + name);
      commandNames.add(name);
    }
    report.push({ id: module.id, commands: module.commands.length });
  }
  return { modules: report, commandCount: commandNames.size };
}

export async function loadModuleCommands(collection) {
  validateModuleCatalog();
  for (const module of moduleCatalog) {
    for (const name of module.commands) {
      const command = await import(new URL('./' + module.id + '/commands/' + name + '.js', import.meta.url));
      if (command.data?.name !== name || typeof command.execute !== 'function') {
        throw new Error('Invalid command definition in ' + module.id + ': ' + name);
      }
      if (collection.has(name)) throw new Error('Command already registered: ' + name);
      installHideOption(command.data);
      collection.set(name, command);
    }
  }
  return collection;
}
