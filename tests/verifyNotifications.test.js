import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { sendVerifyNotification } from '../src/services/verify.js';
import { data as verifyCommand } from '../src/commands/verify.js';

test('verify join sends and deletes mention immediately before DM', async () => {
  const original = config.verify;
  const originalVerified = config.verifiedRoleId;
  config.verify = { ...original, enabled: true, channelId: '1900000000000000001' };
  config.verifiedRoleId = '1900000000000000002';
  try {
    const calls = [];
    const message = { delete: async () => { calls.push('delete'); } };
    const channel = {
      isTextBased: () => true,
      send: async payload => {
        calls.push('send');
        assert.equal(payload.content, '<@1900000000000000003>');
        assert.deepEqual(payload.allowedMentions.users, ['1900000000000000003']);
        return message;
      }
    };
    const member = {
      id: '1900000000000000003',
      user: { bot: false },
      roles: { cache: { has: () => false } },
      guild: {
        name: 'Opus Client',
        channels: { fetch: async () => channel }
      },
      send: async payload => {
        calls.push('dm');
        assert.equal(payload.components[0].components[0].data.custom_id, 'verify_button');
      }
    };
    const result = await sendVerifyNotification(member);
    assert.deepEqual(calls, ['send', 'delete', 'dm']);
    assert.deepEqual(result, { sent: true, pinged: true });
  } finally {
    config.verify = original;
    config.verifiedRoleId = originalVerified;
  }
});

test('DM blocked still triggers immediate mention deletion', async () => {
  const original = config.verify;
  config.verify = { ...original, enabled: true, channelId: '1900000000000000001' };
  try {
    const calls = [];
    const member = {
      id: '1900000000000000004',
      user: { bot: false },
      roles: { cache: { has: () => false } },
      guild: {
        name: 'Opus Client',
        channels: { fetch: async () => ({
          isTextBased: () => true,
          send: async () => {
            calls.push('send');
            return { delete: async () => { calls.push('delete'); } };
          }
        }) }
      },
      send: async () => {
        calls.push('dm');
        throw new Error('DM blocked');
      }
    };
    const result = await sendVerifyNotification(member);
    assert.deepEqual(calls, ['send', 'delete', 'dm']);
    assert.deepEqual(result, { sent: false, pinged: true });
  } finally {
    config.verify = original;
  }
});

test('/verify is available to members as a slash command', () => {
  const command = verifyCommand.toJSON();
  assert.equal(command.name, 'verify');
  assert.equal(command.default_member_permissions, undefined);
  assert.match(command.description, /verify your membership/i);
});
