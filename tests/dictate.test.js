import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags } from 'discord.js';
import { config } from '../src/config.js';
import { data, execute as executeDictate } from '../src/commands/dictate.js';
import {
  appendDictateMentions,
  appendDictateChannelMentions,
  appendDictateReferences,
  buildDictateMentionModal,
  buildDictateColorModal,
  buildDictateMessage,
  buildDictateModal,
  buildDictatePreview,
  canDictate,
  handleDictateInteraction,
  validateDictateDraft
} from '../src/services/dictate.js';

const guildId = config.guildId;
const userId = '1320303839701897230';
const channelId = '1573025575537221784';

function user(role = config.roleBranches.staff[2]) {
  return {
    id: userId,
    roles: { cache: new Map([[role, {}]]) }
  };
}

function interactionWithRole(role) {
  return {
    guildId,
    user: { id: userId },
    member: user(role),
    guild: { ownerId: '999999999999999999' }
  };
}

test('dictate allows Administrator, Manager and Founder, but not Principal Engineer or Moderator', () => {
  for (const role of config.roleBranches.staff.slice(0, 3)) {
    assert.equal(canDictate(interactionWithRole(role)), true);
  }
  for (const role of [config.roleBranches.staff[3], config.roleBranches.development[0]]) {
    assert.equal(canDictate(interactionWithRole(role)), false);
  }
  const owner = interactionWithRole(config.roleBranches.staff[4]);
  owner.guild.ownerId = userId;
  assert.equal(canDictate(owner), true);
});

test('dictate editor includes target, format, member/role, channel picker, and content', () => {
  const modal = buildDictateModal('0123456789abcdef', {
    channelId,
    format: 'text',
    content: 'Hello **world**',
    title: 'Title',
    color: '#5865F2'
  }).toJSON();
  assert.equal(modal.custom_id, 'dictate:modal:0123456789abcdef');
  assert.deepEqual(modal.components.map(c => c.component.type), [8, 3, 7, 8, 4]);
  assert.equal(modal.components[3].component.custom_id, 'dictate_tag_channels');
  assert.equal(modal.components[3].component.required, false);
  assert.equal(modal.components[4].component.value, 'Hello **world**');
  assert.equal(modal.components[2].component.required, false);
  assert.equal(modal.components[2].component.max_values, 10);
  assert.equal(modal.components[0].component.default_values[0].id, channelId);
  assert.equal(modal.components[1].component.options.find(o => o.default).value, 'text');
});

test('dictate enforces the Discord text limit and validates embed hex colors', () => {
  const draft = { channelId, format: 'text', content: 'x'.repeat(2001), title: '', color: '' };
  assert.match(validateDictateDraft(draft), /2,000/);
  draft.format = 'embed';
  assert.equal(validateDictateDraft(draft), null);
  draft.color = '#ggg';
  assert.match(validateDictateDraft(draft), /hex/);
  draft.color = '#112233';
  assert.equal(validateDictateDraft(draft), null);
  assert.equal(buildDictateMessage(draft).embeds[0].data.color, 0x112233);
  draft.format = 'text';
  draft.content = '@everyone Hello';
  draft.color = '';
  assert.deepEqual(buildDictateMessage(draft).allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(buildDictatePreview('0123456789abcdef', draft).components[0].components.length, 4);
});

test('dictate rejects unauthorized command use and does not open a modal', async () => {
  const replies = [];
  const interaction = {
    ...interactionWithRole(config.roleBranches.development[0]),
    reply: async payload => replies.push(payload),
    showModal: async () => { throw new Error('must not open'); }
  };
  await executeDictate(interaction);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('dictate modal preview publishes once and records the actor in the audit log', async () => {
  let modal;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async next => { modal = next; }
  };
  await executeDictate(source);
  assert.equal(data.name, 'dictate');
  assert.ok(modal);

  const previewResponses = [];
  const fields = {
    getSelectedChannels: id => id === 'dictate_channel' ? { first: () => ({ id: channelId }) } : null,
    getStringSelectValues: () => ['embed'],
    getSelectedMentionables: () => null,
    getTextInputValue: id => ({
      dictate_content: 'Hello **Opus**',
      dictate_title: 'Notice',
      dictate_color: '#aabbcc'
    }[id] || '')
  };
  const submit = {
    ...source,
    customId: modal.toJSON().custom_id,
    fields,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    isButton: () => false,
    reply: async payload => previewResponses.push(payload)
  };
  assert.equal(await handleDictateInteraction(submit), true);
  assert.equal(previewResponses[0].flags, 0);
  assert.equal(previewResponses[0].embeds.length, 2);
  assert.equal(previewResponses[0].embeds[1].data.description, 'Hello **Opus**');

  const sent = [];
  const audits = [];
  const member = user();
  const bot = { id: '1567868474376851478' };
  const target = {
    id: channelId,
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    send: async payload => {
      sent.push(payload);
      return {
        id: '1573027777777777777',
        url: 'https://discord.com/channels/' + guildId + '/' + channelId + '/1573027777777777777'
      };
    }
  };
  const audit = {
    isTextBased: () => true,
    send: async payload => {
      audits.push(payload);
      return { id: '1573029999999999999' };
    }
  };
  const guild = {
    ownerId: source.guild.ownerId,
    channels: {
      cache: new Map([[config.auditLogChannelId, audit]]),
      fetch: async id => id === channelId ? target : null
    },
    members: {
      me: bot,
      fetch: async () => member
    }
  };
  const updates = [];
  const id = submit.customId.split(':')[2];
  const button = {
    ...source,
    guild,
    customId: 'dictate:send:' + id,
    isButton: () => true,
    isModalSubmit: () => false,
    deferUpdate: async () => {},
    editReply: async payload => updates.push(payload),
    reply: async payload => updates.push(payload)
  };

  assert.equal(await handleDictateInteraction(button), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].data.title, undefined);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(audits.length, 1);
  assert.match(JSON.stringify(audits[0]), /Dictate Published/);
  assert.match(JSON.stringify(audits[0]), new RegExp(userId));
  assert.match(updates[0].content, /Published successfully/);
  await handleDictateInteraction(button);
  assert.equal(sent.length, 1);
});

test('dictate mention picker adds user and role pings and can preview them without notifications', async () => {
  let composer;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    options: { getBoolean: () => false },
    showModal: async next => { composer = next; }
  };
  await executeDictate(source);
  const responses = [];
  const modalSubmit = {
    ...source,
    customId: composer.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel' ? { first: () => ({ id: channelId }) } : null,
      getStringSelectValues: () => ['embed'],
      getSelectedMentionables: () => null,
      getTextInputValue: id => ({ dictate_content: 'Hello team', dictate_title: 'Update', dictate_color: '' }[id] || '')
    },
    reply: async payload => responses.push(payload)
  };
  await handleDictateInteraction(modalSubmit);
  assert.equal(responses[0].flags, 0);
  const id = modalSubmit.customId.split(':')[2];
  let mentionModal;
  const mentionButton = {
    ...source,
    customId: 'dictate:mentions:' + id,
    isButton: () => true,
    showModal: async value => { mentionModal = value; }
  };
  await handleDictateInteraction(mentionButton);
  assert.equal(mentionModal.toJSON().components[0].component.type, 7);
  const edited = [];
  const mentionSubmit = {
    ...source,
    customId: mentionModal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    fields: {
      getSelectedMentionables: () => ({
        users: new Map([['1355555555555555555', {}]]),
        members: new Map(),
        roles: new Map([['1566425766005317792', {}]])
      }),
      getSelectedChannels: () => null
    },
    update: async payload => edited.push(payload)
  };
  await handleDictateInteraction(mentionSubmit);
  assert.equal(edited.length, 1);
  assert.match(edited[0].embeds[1].data.description, /<@1355555555555555555>/);
  assert.match(edited[0].embeds[1].data.description, /<@&1566425766005317792>/);
  assert.deepEqual(edited[0].allowedMentions, { parse: [] });
  const message = buildDictateMessage({
    channelId,
    format: 'embed',
    content: edited[0].embeds[1].data.description,
    title: 'Update',
    color: ''
  });
  assert.deepEqual(message.allowedMentions.users, ['1355555555555555555']);
  assert.deepEqual(message.allowedMentions.roles, ['1566425766005317792']);
  assert.equal(message.content, null);
  assert.match(message.embeds[0].data.description, /<@1355555555555555555>/);
  assert.match(message.embeds[0].data.description, /<@&1566425766005317792>/);
});

test('dictate hide Yes makes preview private, otherwise it is visible by default', async () => {
  let composer;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    options: { getBoolean: name => name === 'hide' },
    showModal: async next => { composer = next; }
  };
  await executeDictate(source);
  const replies = [];
  const submit = {
    ...source,
    customId: composer.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel' ? { first: () => ({ id: channelId }) } : null,
      getStringSelectValues: () => ['text'],
      getSelectedMentionables: () => null,
      getTextInputValue: id => id === 'dictate_content' ? 'Public on publish' : ''
    },
    reply: async payload => replies.push(payload)
  };
  await handleDictateInteraction(submit);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].embeds[0].data.description, /Only you can see/);
});

test('dictate raw mention tokens get ping permissions, everyone remains disabled', () => {
  const draft = { channelId, format: 'text', content: 'Please <@1355555555555555555> see <@&1566425766005317792> @everyone', title: '', color: '' };
  const message = buildDictateMessage(draft);
  assert.deepEqual(message.allowedMentions, {
    parse: [],
    users: ['1355555555555555555'],
    roles: ['1566425766005317792'],
    repliedUser: false
  });
  const noDuplicate = appendDictateMentions(draft, {
    users: new Map([['1355555555555555555', {}]]),
    roles: new Map([['1566425766005317792', {}]])
  }, guildId);
  assert.equal(noDuplicate.content, draft.content);
  assert.equal(buildDictateMentionModal('0123456789abcdef').toJSON().components.length, 2);
});

test('dictate initial editor picks user/role mentions without a separate modal', async () => {
  let composer;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async next => { composer = next; }
  };
  await executeDictate(source);
  const responses = [];
  const submit = {
    ...source,
    customId: composer.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel' ? { first: () => ({ id: channelId }) } : null,
      getStringSelectValues: () => ['embed'],
      getSelectedMentionables: () => ({
        users: new Map([['1355555555555555555', {}]]),
        members: new Map(),
        roles: new Map([['1566425766005317792', {}]])
      }),
      getTextInputValue: id => ({
        dictate_content: 'Hello team',
        dictate_title: 'Test'
      }[id] || '')
    },
    reply: async payload => responses.push(payload)
  };
  await handleDictateInteraction(submit);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].flags, 0);
  assert.equal(responses[0].embeds.length, 2);
  assert.match(responses[0].embeds[1].data.description, /<@1355555555555555555>/);
  assert.match(responses[0].embeds[1].data.description, /<@&1566425766005317792>/);
  assert.deepEqual(responses[0].allowedMentions, { parse: [] });
});

test('dictate changes embed color from preview without losing the draft', async () => {
  let composer;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async next => { composer = next; }
  };
  await executeDictate(source);
  const previews = [];
  const submit = {
    ...source,
    customId: composer.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel' ? { first: () => ({ id: channelId }) } : null,
      getStringSelectValues: () => ['embed'],
      getSelectedMentionables: () => null,
      getTextInputValue: id => id === 'dictate_content' ? 'Version update' : ''
    },
    reply: async payload => previews.push(payload)
  };
  await handleDictateInteraction(submit);
  const id = submit.customId.split(':')[2];
  assert.equal(previews[0].components[0].components.length, 5);
  let colorModal;
  await handleDictateInteraction({
    ...source,
    customId: 'dictate:color:' + id,
    isButton: () => true,
    showModal: async next => { colorModal = next; }
  });
  assert.equal(colorModal.toJSON().components[0].component.custom_id, 'dictate_title');
  assert.equal(colorModal.toJSON().components[1].component.custom_id, 'dictate_color');
  const changes = [];
  await handleDictateInteraction({
    ...source,
    customId: colorModal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    fields: { getTextInputValue: id => id === 'dictate_title' ? 'Announcement' : '#ABCDEF' },
    update: async payload => changes.push(payload)
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].embeds[1].data.color, 0xABCDEF);
  assert.equal(changes[0].embeds[1].data.title, 'Announcement');
  assert.equal(changes[0].embeds[1].data.description, 'Version update');
});

test('member and channel selections append real tokens that can be freely moved through Edit Content', async () => {
  let modal;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async value => { modal = value; }
  };
  await executeDictate(source);
  const previews = [];
  const tagChannelId = '1573025584823533708';
  const userTag = '1355555555555555555';
  const roleTag = '1566425766005317792';
  await handleDictateInteraction({
    ...source,
    customId: modal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel'
        ? { first: () => ({ id: channelId }) }
        : new Map([[tagChannelId, { id: tagChannelId }]]),
      getSelectedMentionables: () => ({
        users: new Map([[userTag, {}]]),
        members: new Map(),
        roles: new Map([[roleTag, {}]])
      }),
      getStringSelectValues: () => ['embed'],
      getTextInputValue: id => id === 'dictate_content' ? 'The giveaway begins soon.' : ''
    },
    reply: async payload => previews.push(payload)
  });
  const description = previews[0].embeds[1].data.description;
  assert.ok(description.startsWith('The giveaway begins soon.'));
  assert.ok(description.includes('<@' + userTag + '>'));
  assert.ok(description.includes('<@&' + roleTag + '>'));
  assert.ok(description.endsWith('<#' + tagChannelId + '>'));
  const id = modal.toJSON().custom_id.split(':')[2];
  let editor;
  await handleDictateInteraction({
    ...source,
    customId: 'dictate:edit:' + id,
    isButton: () => true,
    showModal: async value => { editor = value; }
  });
  assert.equal(editor.toJSON().components[4].component.value, description);
  assert.equal(editor.toJSON().components[0].component.default_values[0].id, channelId);
  const movedContent = 'Hello <@' + userTag + '> in <#' + tagChannelId + '>!\nContact <@&' + roleTag + '>.';
  const edits = [];
  await handleDictateInteraction({
    ...source,
    customId: editor.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel'
        ? { first: () => ({ id: channelId }) } : null,
      getSelectedMentionables: () => null,
      getStringSelectValues: () => ['embed'],
      getTextInputValue: id => id === 'dictate_content' ? movedContent : ''
    },
    update: async payload => edits.push(payload)
  });
  assert.equal(edits[0].embeds[1].data.description, movedContent);
  assert.deepEqual(buildDictateMessage({ format: 'embed', content: movedContent, title: '', color: '' }).allowedMentions, {
    parse: [], users: [userTag], roles: [roleTag], repliedUser: false
  });
  const unchanged = appendDictateChannelMentions({ content: movedContent }, new Map([[tagChannelId, {}]]));
  assert.equal(unchanged.content, movedContent);
});

test('Add Tags supports channel-only selection and avoids duplicated references', async () => {
  let modal;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async value => { modal = value; }
  };
  await executeDictate(source);
  const previews = [];
  await handleDictateInteraction({
    ...source,
    customId: modal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: id => id === 'dictate_channel'
        ? { first: () => ({ id: channelId }) } : null,
      getSelectedMentionables: () => null,
      getStringSelectValues: () => ['text'],
      getTextInputValue: id => id === 'dictate_content' ? 'Visit the channel' : ''
    },
    reply: async payload => previews.push(payload)
  });
  let tagModal;
  const id = modal.toJSON().custom_id.split(':')[2];
  await handleDictateInteraction({
    ...source,
    customId: 'dictate:mentions:' + id,
    isButton: () => true,
    showModal: async value => { tagModal = value; }
  });
  assert.deepEqual(tagModal.toJSON().components.map(x => x.component.type), [7, 8]);
  const tagChannelId = '1573025584823533708';
  const updates = [];
  await handleDictateInteraction({
    ...source,
    customId: tagModal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    fields: {
      getSelectedMentionables: () => null,
      getSelectedChannels: () => new Map([[tagChannelId, {}]])
    },
    update: async payload => updates.push(payload)
  });
  assert.ok(updates[0].content.endsWith('<#' + tagChannelId + '>'));
  const unchanged = appendDictateReferences(
    { content: updates[0].content },
    null,
    new Map([[tagChannelId, {}]]),
    guildId
  );
  assert.equal(unchanged.content, updates[0].content);
});

test('tag-only submission works with empty Content and reopens with editable tokens', async () => {
  let modal;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async next => { modal = next; }
  };
  await executeDictate(source);
  assert.equal(modal.toJSON().components[4].component.required, false);
  const previews = [];
  const channelToMention = '1573025584823533708';
  const personToMention = '1355555555555555555';
  await handleDictateInteraction({
    ...source,
    customId: modal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: name => name === 'dictate_channel'
        ? { first: () => ({ id: channelId }) }
        : new Map([[channelToMention, {}]]),
      getSelectedMentionables: () => ({
        users: new Map([[personToMention, {}]]),
        roles: new Map(),
        members: new Map()
      }),
      getStringSelectValues: () => ['embed'],
      getTextInputValue: () => ''
    },
    reply: async payload => previews.push(payload)
  });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].embeds[1].data.description, '<@' + personToMention + '>\n<#' + channelToMention + '>');
  let editor;
  await handleDictateInteraction({
    ...source,
    customId: 'dictate:edit:' + modal.toJSON().custom_id.split(':')[2],
    isButton: () => true,
    showModal: async value => { editor = value; }
  });
  assert.equal(editor.toJSON().components[4].component.value, previews[0].embeds[1].data.description);
});

test('empty Content without selected references does not publish a blank message', async () => {
  let modal;
  const source = {
    ...interactionWithRole(config.roleBranches.staff[2]),
    showModal: async next => { modal = next; }
  };
  await executeDictate(source);
  const replies = [];
  await handleDictateInteraction({
    ...source,
    customId: modal.toJSON().custom_id,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getSelectedChannels: name => name === 'dictate_channel'
        ? { first: () => ({ id: channelId }) } : null,
      getSelectedMentionables: () => null,
      getStringSelectValues: () => ['embed'],
      getTextInputValue: () => ''
    },
    reply: async payload => replies.push(payload)
  });
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /Add a message or at least one image/);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});
