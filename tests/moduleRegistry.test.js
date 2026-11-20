import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../src/utils/loaders.js';
import { loadModuleCommands, moduleCatalog, resolveModuleCommandPath, validateModuleCatalog } from '../src/modules/registry.js';

test('every slash command belongs to exactly one module', () => {
  const catalog = validateModuleCatalog();
  assert.equal(catalog.modules.length, 10);
  assert.equal(catalog.commandCount, 26);
  assert.deepEqual(moduleCatalog.find(module => module.id === 'oai').commands, []);
  assert.ok(moduleCatalog.some(module => module.id === 'management'));
  assert.ok(moduleCatalog.some(module => module.id === 'moderation'));
});

test('module runtime and legacy command imports match', async () => {
  const modern = await loadModuleCommands(new Map());
  const legacy = await loadCommands(path.resolve('src/commands'), new Map());
  assert.deepEqual([...modern.keys()].sort(), [...legacy.keys()].sort());
  for (const [name, command] of modern) {
    assert.equal(command.execute, legacy.get(name).execute, name);
    assert.deepEqual(command.data.toJSON(), legacy.get(name).data.toJSON(), name);
    assert.ok(resolveModuleCommandPath(name).includes('/modules/'));
  }
});

test('unowned command names are rejected', () => {
  assert.throws(() => resolveModuleCommandPath('unknown-command'), /Unassigned/);
});

test('OAI module facade loads without importing unfinished implementations', async () => {
  const api = await import('../src/modules/oai/api.js');
  assert.equal(typeof api.loadAuthorityDecisions, 'function');
  assert.equal(typeof api.loadRoleIntegrity, 'function');
});
