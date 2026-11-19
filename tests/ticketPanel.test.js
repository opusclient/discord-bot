import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'opus-ticket-panel-test-'));
process.env.DB_PATH = join(dir, 'tickets.sqlite');

const { db, createTicketRow, getTicketStats, claimTicketRow, closeTicketRow, getOpenTicketByOwner, setInstallMessage, getInstallMessage } = await import('../src/db.js');
const { buildTicketPanelPayload, buildTicketPanelActionPayload, buildTicketPurposeModal, refreshTicketPanelMessage, TICKET_TYPES, TICKET_PANEL_ACTIONS, TICKET_PANEL_MESSAGE_KEY, parseTicketModalType } = await import('../src/services/tickets.js');

test('ticket panel uses one Components V2 container with all nine categories', () => {
  const payload = buildTicketPanelPayload('123456789012345678');
  const components = payload.components.map(item => item.toJSON());
  assert.equal(components.length, 1);
  assert.equal(components[0].type, 17);
  assert.equal(components[0].components.length, 10);
  assert.equal(components[0].components.some(item => item.type === 9), false);
  assert.equal(payload.flags, 32768);
  const text = components[0].components.filter(item => item.type === 10)
    .map(item => item.content).join('\n');
  assert.match(text, /SUPPORT CENTER/);
  assert.match(text, /How can we help/);
  assert.match(text, /TICKET ACTIVITY/);
  assert.match(text, /SUPPORT & ACCOUNTS/);
  assert.match(text, /REPORTS & APPEALS/);
  assert.match(text, /TEAM & PRIORITY/);
  assert.match(text, /Create a ticket/);
  const rows = components[0].components.filter(item => item.type === 1);
  assert.equal(rows.length, 2);
  const dropdown = rows[0].components[0];
  assert.equal(dropdown.custom_id, 'ticket_select_category');
  assert.equal(dropdown.options.length, 9);
  assert.deepEqual(dropdown.options.map(item => item.value), Object.keys(TICKET_TYPES));
  assert.deepEqual(rows[1].components.map(item => item.custom_id), Object.values(TICKET_PANEL_ACTIONS));
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(parseTicketModalType('ticket_purpose_modal:priority'), 'priority');
  assert.equal(parseTicketModalType('ticket_purpose_modal:nonexistent'), null);
  const modal = buildTicketPurposeModal('priority').toJSON();
  assert.equal(modal.title, 'Priority Ticket');
  assert.equal(modal.components[0].components[0].required, true);
});

test('panel buttons produce user-specific private Components V2 responses', () => {
  const guildId = '123456789012345720';
  const userId = '123456789012345721';
  const otherId = '123456789012345722';
  createTicketRow({
    guildId, channelId: '123456789012345723', ownerId: userId,
    type: 'technical', purpose: 'Launcher crashes repeatedly'
  });
  createTicketRow({
    guildId, channelId: '123456789012345724', ownerId: otherId,
    type: 'security', purpose: 'Responsible disclosure'
  });
  for (const action of Object.values(TICKET_PANEL_ACTIONS)) {
    const payload = buildTicketPanelActionPayload(action, guildId, userId);
    assert.equal(payload.components.length, 1);
    assert.equal(payload.flags & 32768, 32768);
    assert.equal(payload.flags & 64, 64);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
  const mine = JSON.stringify(buildTicketPanelActionPayload(TICKET_PANEL_ACTIONS.my, guildId, userId).components[0].toJSON());
  assert.match(mine, /Technical Support/);
  assert.match(mine, /123456789012345723/);
  assert.doesNotMatch(mine, /123456789012345724/);
  const status = JSON.stringify(buildTicketPanelActionPayload(TICKET_PANEL_ACTIONS.status, guildId, userId).components[0].toJSON());
  assert.match(status, /Support Activity/);
  assert.match(status, /Open/);
  const guide = JSON.stringify(buildTicketPanelActionPayload(TICKET_PANEL_ACTIONS.guide, guildId, userId).components[0].toJSON());
  assert.match(guide, /SUPPORT GUIDE/);
  assert.match(guide, /Security/);
  assert.throws(() => buildTicketPanelActionPayload('unknown', guildId, userId));
});

test('ticket panel refresh edits the existing message instead of reposting', async () => {
  const guildId = '123456789012345730';
  const channelId = '123456789012345731';
  const messageId = '123456789012345732';
  let edits = 0;
  let sends = 0;
  setInstallMessage(guildId, TICKET_PANEL_MESSAGE_KEY, channelId, messageId);
  const message = {
    id: messageId,
    author: { id: '123456789012345733' },
    edit: async payload => {
      edits++;
      assert.equal(payload.components.length, 1);
      assert.equal(payload.flags & 32768, 32768);
      return message;
    }
  };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async id => id === messageId ? message : null },
    send: async () => { sends++; return message; }
  };
  const client = {
    user: { id: message.author.id },
    guilds: { cache: new Map([[guildId, {
      id: guildId,
      channels: { fetch: async id => id === channelId ? channel : null }
    }]]) }
  };
  const originalConfig = (await import('../src/config.js')).config;
  const saved = originalConfig.guildId;
  const panelId = originalConfig.tickets.panelChannelId;
  originalConfig.guildId = guildId;
  originalConfig.tickets.panelChannelId = channelId;
  try {
    const updated = await refreshTicketPanelMessage(client);
    assert.equal(updated?.id, messageId);
    assert.equal(edits, 1);
    assert.equal(sends, 0);
    assert.equal(getInstallMessage(guildId, TICKET_PANEL_MESSAGE_KEY).message_id, messageId);
  } finally {
    originalConfig.guildId = saved;
    originalConfig.tickets.panelChannelId = panelId;
  }
});

test('ticket lifecycle tracks open, claimed and closed without losing the purpose', () => {
  const guildId = '123456789012345678';
  const ownerId = '123456789012345679';
  const staffId = '123456789012345680';
  assert.deepEqual(getTicketStats(guildId), {open:0,claimed:0,closed:0});
  const ticket = createTicketRow({
    guildId, channelId:'123456789012345681', ownerId, type:'priority',
    purpose:'An urgent launcher startup failure',
  });
  assert.equal(ticket.purpose, 'An urgent launcher startup failure');
  assert.deepEqual(getTicketStats(guildId), {open:1,claimed:0,closed:0});
  assert.equal(claimTicketRow(ticket.id,staffId).claimed,true);
  assert.deepEqual(getTicketStats(guildId), {open:0,claimed:1,closed:0});
  assert.match(claimTicketRow(ticket.id,'123456789012345682').error,/another staff/);
  assert.equal(claimTicketRow(ticket.id,staffId).claimed,false);
  assert.deepEqual(getTicketStats(guildId), {open:1,claimed:0,closed:0});
  assert.ok(getOpenTicketByOwner(guildId, ownerId, 'priority'));
  closeTicketRow(ticket.id,{closedBy:staffId});
  assert.equal(getOpenTicketByOwner(guildId,ownerId,'priority'),null);
  assert.deepEqual(getTicketStats(guildId), {open:0,claimed:0,closed:1});
});

test('legacy ticket rows remain counted and receive nullable new columns', () => {
  const guildId='123456789012345683';
  db.prepare('INSERT INTO tickets (guild_id, channel_id, owner_id, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId,'123456789012345684','123456789012345685','general','closed',Date.now());
  assert.deepEqual(getTicketStats(guildId), {open:0,claimed:0,closed:1});
});

test.after(() => {
  db.close();
  rmSync(dir,{recursive:true,force:true});
});
