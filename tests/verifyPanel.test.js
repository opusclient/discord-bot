import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags, ButtonStyle } from 'discord.js';
import { buildVerifyPayload, VERIFY_BUTTON_ID } from '../src/services/verify.js';

const createGuild = icon => ({
  name: 'Opus Client',
  iconURL: () => icon,
  channels: {
    cache: new Collection([
      ['rules', { id: '1566418277423513670', name: 'rules' }],
    ]),
  },
});

test('verification panel uses Components V2 with a single prominent action', () => {
  const payload = buildVerifyPayload(createGuild('https://cdn.discordapp.com/embed/avatars/0.png'));
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);
  const container = payload.components[0].toJSON();
  assert.equal(container.type, 17);
  assert.equal(container.components[0].type, 9);
  const button = container.components.find(component => component.type === 1)?.components[0];
  assert.equal(button.custom_id, VERIFY_BUTTON_ID);
  assert.equal(button.style, ButtonStyle.Primary);
  assert.equal(button.label, 'Verify & Continue');
  assert.ok(container.components.some(component => component.type === 10 && component.content.includes('<#1566418277423513670>')));
});

test('verification panel without a server icon remains valid', () => {
  const payload = buildVerifyPayload(createGuild(null));
  const container = payload.components[0].toJSON();
  assert.equal(container.components[0].type, 10);
  assert.equal(container.components.at(-1).components[0].custom_id, VERIFY_BUTTON_ID);
});
