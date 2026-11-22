import assert from 'node:assert/strict';
import test from 'node:test';
import { isMuteInternalChannel, applyMuteOverwrite } from '../src/services/mutes.js';
import { config } from '../src/config.js';

const role = { id: 'muted' };
const policy = { muteInternalCategoryIds: ['internal'] };

test('configured team category and its children are mute exempt', () => {
  assert.equal(isMuteInternalChannel({ id: 'internal', parentId: null }, policy), true);
  assert.equal(isMuteInternalChannel({ id: 'chat', parentId: 'internal' }, policy), true);
  assert.equal(isMuteInternalChannel({ id: 'public', parentId: 'community' }, policy), false);
});

test('internal channels remove only the Muted overwrite', async () => {
  const previous = new Map([['muted', { id: 'muted' }], ['staff', { id: 'staff' }]]);
  let removed = null;
  let edited = 0;
  const channel = {
    id: 'private-chat',
    parentId: config.muteInternalCategoryIds[0],
    permissionOverwrites: {
      cache: previous,
      delete: async target => { removed = target.id; previous.delete(target.id); },
      edit: async () => { edited += 1; }
    }
  };
  await applyMuteOverwrite(channel, role);
  assert.equal(removed, 'muted');
  assert.equal(previous.has('staff'), true);
  assert.equal(edited, 0);
});

test('regular channels continue receiving Muted restrictions', async () => {
  let options = null;
  const channel = {
    id: 'public',
    parentId: '1566420576942170122',
    isVoiceBased: () => false,
    permissionOverwrites: {
      cache: new Map(),
      edit: async (_role, next) => { options = next; }
    }
  };
  await applyMuteOverwrite(channel, role);
  assert.equal(options.SendMessages, false);
  assert.equal(options.AddReactions, false);
  assert.equal(options.SendMessagesInThreads, false);
});
