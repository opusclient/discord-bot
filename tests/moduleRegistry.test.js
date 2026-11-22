import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadCommands } from '../src/utils/loaders.js';

test('slash commands have unique names and valid definitions', async () => {
  const commands = await loadCommands(path.resolve('src/commands'), new Map());
  assert.equal(commands.size, 27);
  for (const [name, command] of commands) {
    assert.equal(command.data.toJSON().name, name);
    assert.equal(typeof command.execute, 'function');
  }
});

test('all runtime event handlers expose a named executable event', async () => {
  const { readdir } = await import('node:fs/promises');
  const events = (await readdir('src/events')).filter(name => name.endsWith('.js'));
  assert.equal(events.length, 21);
  for (const file of events) {
    const event = await import('../src/events/' + file);
    assert.equal(typeof event.name, 'string');
    assert.equal(typeof event.execute, 'function');
  }
});

test('authority modules are loadable without network access', async () => {
  const decisions = await import('../src/services/authorityDecisions.js');
  const integrity = await import('../src/services/roleIntegrity.js');
  assert.equal(typeof decisions.AuthorityDecisionStore, 'function');
  assert.equal(typeof integrity.initializeAuthorityIntegrity, 'function');
});
