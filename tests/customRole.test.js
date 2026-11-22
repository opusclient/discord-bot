import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationCommandOptionType } from 'discord.js';
import { data } from '../src/commands/customrole.js';
import { parseRoleColor, validateCustomRoleName } from '../src/services/customRoles.js';

test('customrole registers create, delete and list', () => {
  const command = data.toJSON();
  assert.equal(command.name, 'customrole');
  assert.deepEqual(command.options.map(option => option.name), ['create', 'delete', 'list']);
  assert.ok(command.options.every(option => option.type === ApplicationCommandOptionType.Subcommand));
  const create = command.options[0].options;
  assert.deepEqual(create.map(option => option.name), ['name', 'color']);
  assert.ok(create.every(option => option.required === true));
  const remove = command.options[1].options;
  assert.deepEqual(remove.map(option => option.name), ['role', 'confirm']);
  assert.ok(remove.every(option => option.required === true));
});

test('customrole accepts only visible six-digit hex colors', () => {
  assert.deepEqual(parseRoleColor('#7c3aed'), { value: 0x7c3aed, hex: '#7C3AED' });
  assert.deepEqual(parseRoleColor('ABCDEF'), { value: 0xabcdef, hex: '#ABCDEF' });
  for (const color of ['blue', '#fff', '#12345678', '#000000', '', '#ZZZZZZ']) {
    assert.ok(parseRoleColor(color).error, color);
  }
});

test('customrole rejects empty names, multiline names and role mentions', () => {
  assert.equal(validateCustomRoleName('  Sapphire  ').value, 'Sapphire');
  for (const name of ['', ' ', 'A'.repeat(101), 'first\nsecond', '@everyone', '<@&123456789012345678>']) {
    assert.ok(validateCustomRoleName(name).error, name);
  }
});
