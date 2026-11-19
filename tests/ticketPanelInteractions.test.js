import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const folder = mkdtempSync(join(tmpdir(), 'opus-ticket-ui-'));
process.env.DB_PATH = join(folder, 'tickets.sqlite');

const { config } = await import('../src/config.js');
const { db, createTicketRow } = await import('../src/db.js');
const { execute } = await import('../src/events/interactionCreate.js');
const { TICKET_PANEL_ACTIONS, TICKET_SELECT_ID } = await import('../src/services/tickets.js');

const userId = '123456789012345688';

function button(action) {
  const replies = [];
  const interaction = {
    guildId: config.guildId,
    user: { id: userId },
    customId: action,
    inGuild: () => true,
    isButton: () => true,
    reply: async value => replies.push(value)
  };
  return { interaction, replies };
}

test('ticket panel button actions are routed to user-only Components V2 messages', async () => {
  createTicketRow({
    guildId: config.guildId,
    channelId: '123456789012345689',
    ownerId: userId,
    type: 'general',
    purpose: 'A support request'
  });
  for (const action of Object.values(TICKET_PANEL_ACTIONS)) {
    const { interaction, replies } = button(action);
    await execute(interaction, {});
    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
    assert.equal(replies[0].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  }
  const { interaction, replies } = button(TICKET_PANEL_ACTIONS.my);
  await execute(interaction, {});
  assert.match(JSON.stringify(replies[0].components[0].toJSON()), /123456789012345689/);
});

test('ticket category selection keeps the purpose modal intact', async () => {
  const modals = [];
  const interaction = {
    guildId: config.guildId,
    user: { id: userId },
    customId: TICKET_SELECT_ID,
    values: ['technical'],
    inGuild: () => true,
    isButton: () => false,
    isStringSelectMenu: () => true,
    showModal: async modal => modals.push(modal.toJSON())
  };
  await execute(interaction, {});
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, 'Technical Support Ticket');
  assert.equal(modals[0].components[0].components[0].required, true);
});

test.after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
