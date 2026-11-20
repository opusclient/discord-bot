// Ticket system: the panel posts one button per ticket type (general tickets / guild
// applications); each type spawns a private channel into its own category, visible
// only to the ticket owner, the configured staff role and the bot.
// In-ticket commands (slash and prefix): rename, close, add, remove.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionsBitField,
  Role,
  OverwriteType,
  TextDisplayBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config, updateFileConfig } from '../config.js';
import { archiveLogMessage } from './logIntegrityStore.js';
import { COLORS } from '../constants.js';
import {
  closeTicketRow,
  createTicketRow,
  reserveTicketNumber,
  claimTicketRow,
  getTicketStats,
  getInstallMessage,
  getOpenTicketByOwner,
  listOpenTicketsForOwner,
  getTicketByChannel,
  listTicketChannelIds,
  setInstallMessage,
} from '../db.js';
import { baseEmbed, ts, truncate } from '../utils/embeds.js';

export const TICKET_PANEL_MESSAGE_KEY = 'ticket_panel';
export const TICKET_BUTTON_ID = 'ticket_open';
export const TICKET_CLOSE_BUTTON_ID = 'ticket_close';
export const TICKET_CLAIM_BUTTON_ID = 'ticket_claim';
export const TICKET_SELECT_ID = 'ticket_select_category';
export const TICKET_PURPOSE_MODAL_ID = 'ticket_purpose_modal';
export const TICKET_PURPOSE_INPUT_ID = 'ticket_purpose_input';

// Posted automatically in every staff application ticket so the applicant can copy
// the format and fill it in (one field per line).
export const APPLICATION_TEMPLATE = [
  'Discord username ·',
  'Position applying for ·',
  'Time zone ·',
  'Availability ·',
  'Relevant experience ·',
  'Motivation ·',
  'Portfolio (optional) ·',
];

// The application card: explanation + the template inside a code block, which is the
// easiest thing to select and copy in the Discord client.
function buildApplicationEmbed() {
  return baseEmbed(COLORS.info)
    .setTitle('Staff Application')
    .setDescription(
      [
        'Fill in the template below and send it in this ticket.',
        'Copy the block, replace every dot with your answer:',
        '',
        '```',
        ...APPLICATION_TEMPLATE,
        '```',
      ].join('\n'),
    )
    .setFooter({ text: `${config.botName ?? 'Opus System'} • incomplete applications may be denied` });
}

// Ticket types: each spawns into its own category (auto-created by /install and
// written back to config.json) and follows the per-type one-open-ticket rule.
export const TICKET_TYPES = {
  priority: {
    key: 'priority',
    label: 'Priority',
    description: 'Urgent issues requiring staff attention',
    channelPrefix: 'priority-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  general: {
    key: 'general',
    label: 'General',
    description: 'General questions and community support',
    channelPrefix: 'ticket-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  technical: {
    key: 'technical',
    label: 'Technical Support',
    description: 'Launcher, client and installation problems',
    channelPrefix: 'technical-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  bugs: {
    key: 'bugs',
    label: 'Bug Report',
    description: 'Report reproducible client or launcher issues',
    channelPrefix: 'bug-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  appeal: {
    key: 'appeal',
    label: 'Appeals',
    description: 'Appeal server moderation decisions',
    channelPrefix: 'appeal-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  account: {
    key: 'account',
    label: 'Account & Linking',
    description: 'Login, account and linking assistance',
    channelPrefix: 'account-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  application: {
    key: 'application',
    label: 'Staff Application',
    description: 'Apply to join the Opus staff team',
    channelPrefix: 'application-',
    categoryIdKey: 'applicationCategoryId',
    categoryNameKey: 'applicationCategoryName',
    defaultCategoryName: 'Staff Applications',
  },
  purchases: {
    key: 'purchases',
    label: 'Purchases',
    description: 'Payments, plans and purchase inquiries',
    channelPrefix: 'purchase-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
  security: {
    key: 'security',
    label: 'Security',
    description: 'Private vulnerability or security reports',
    channelPrefix: 'security-',
    categoryIdKey: 'generalCategoryId',
    categoryNameKey: 'generalCategoryName',
    defaultCategoryName: 'General Tickets',
  },
};
// Panel button ids carry the type suffix: `ticket_open` (legacy = general) and
// `ticket_open:general` / `ticket_open:application`.
export function parseTicketButtonType(customId) {
  if (!customId.startsWith(TICKET_BUTTON_ID)) return null;
  const key = customId.slice(TICKET_BUTTON_ID.length).replace(/^:/, '') || 'general';
  return TICKET_TYPES[key] ? key : null;
}

// Creation entries accept a flags array for role-type overwrites (verified
// against the live API) - creator ownership is applied separately via edit.
const TICKET_MEMBER_ALLOW = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.EmbedLinks,
];

// The flag boolean form for permissionOverwrites.edit(): passing a flags array
// as allow through edit() resolves to an EMPTY overwrite on member entries -
// only the flag boolean form ({ ViewChannel: true, ... }) is reliable there.
const TICKET_MEMBER_FLAGS = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true,
};


// ---------- Panel ----------

export const parseTicketModalType = (customId) => {
  if (!customId.startsWith(TICKET_PURPOSE_MODAL_ID + ':')) return null;
  const key = customId.slice(TICKET_PURPOSE_MODAL_ID.length + 1);
  return Object.hasOwn(TICKET_TYPES, key) ? key : null;
};

export function buildTicketPurposeModal(typeKey) {
  const type = TICKET_TYPES[typeKey];
  if (!type) throw new Error('Unknown ticket type');
  return new ModalBuilder()
    .setCustomId(TICKET_PURPOSE_MODAL_ID + ':' + type.key)
    .setTitle(type.label + ' Ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(TICKET_PURPOSE_INPUT_ID)
          .setLabel('Purpose')
          .setPlaceholder('Describe why you need support')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(10)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
}

export const TICKET_PANEL_ACTIONS = Object.freeze({
  my: 'ticket_panel_my',
  status: 'ticket_panel_status',
  guide: 'ticket_panel_guide'
});

const ticketPanelText = text => new TextDisplayBuilder().setContent(text);
const ticketPanelDivider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

export function buildTicketPanelPayload(guildId = config.guildId) {
  const stats = getTicketStats(guildId);
  const dropdown = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TICKET_SELECT_ID)
      .setPlaceholder('Choose a ticket category')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(Object.values(TICKET_TYPES).map(type => ({
        label: type.label,
        value: type.key,
        description: type.description.slice(0, 100)
      })))
  );
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_PANEL_ACTIONS.my)
      .setLabel('My Tickets')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(TICKET_PANEL_ACTIONS.status)
      .setLabel('Ticket Status')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(TICKET_PANEL_ACTIONS.guide)
      .setLabel('Support Guide')
      .setStyle(ButtonStyle.Secondary)
  );
  const panel = new ContainerBuilder()
    .setAccentColor(0x8070D9)
    .addTextDisplayComponents(ticketPanelText([
      '-# OPUS CLIENT  /  SUPPORT CENTER',
      '## How can we help?',
      'Open a private request and connect with the appropriate team.'
    ].join('\n')))
    .addSeparatorComponents(ticketPanelDivider())
    .addTextDisplayComponents(ticketPanelText([
      '-# TICKET ACTIVITY',
      '**' + stats.open + '**  Open     ·     **' + stats.claimed +
        '**  Claimed     ·     **' + stats.closed + '**  Closed'
    ].join('\n')))
    .addSeparatorComponents(ticketPanelDivider())
    .addTextDisplayComponents(
      ticketPanelText([
        '**SUPPORT & ACCOUNTS**',
        '**General** · Questions and support   ·   **Technical** · Client and launcher',
        '**Account & Linking** · Login and access   ·   **Purchases** · Billing'
      ].join('\n')),
      ticketPanelText([
        '**REPORTS & APPEALS**',
        '**Bug Report** · Bugs and reproduction   ·   **Security** · Private reports',
        '**Appeals** · Moderation decisions'
      ].join('\n')),
      ticketPanelText([
        '**TEAM & PRIORITY**',
        '**Staff Application** · Join the Opus team   ·   **Priority** · Urgent assistance'
      ].join('\n'))
    )
    .addTextDisplayComponents(ticketPanelText([
      '### Create a ticket',
      'Select a category, then describe your request in the form.',
      '-# Only you and authorized ticket staff can see your ticket. Never share passwords or recovery codes.'
    ].join('\n')))
    .addActionRowComponents(dropdown, actions);
  return {
    components: [panel],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

export function buildTicketPanelActionPayload(action, guildId, userId) {
  const stats = getTicketStats(guildId);
  let content;
  if (action === TICKET_PANEL_ACTIONS.my) {
    const tickets = listOpenTicketsForOwner(guildId, userId, 10);
    content = [
      '-# OPUS CLIENT  /  YOUR SUPPORT REQUESTS',
      '## My Tickets',
      tickets.length
        ? tickets.map(ticket => {
          const label = TICKET_TYPES[ticket.type]?.label ?? 'Support';
          const number = String(ticket.ticket_number ?? ticket.id).padStart(4, '0');
          const state = ticket.claimed_by ? 'Claimed' : 'Open';
          return '**#' + number + '** · ' + label + ' · ' + state + '  <#' + ticket.channel_id + '>';
        }).join('\n')
        : 'You have no active tickets. Choose a category from the support panel to create one.',
      tickets.length === 10 ? '-# Showing up to 10 most recent active tickets.' : null
    ].filter(Boolean).join('\n\n');
  } else if (action === TICKET_PANEL_ACTIONS.status) {
    content = [
      '-# OPUS CLIENT  /  LIVE TICKET STATUS',
      '## Support Activity',
      '**Open:** ' + stats.open,
      '**Claimed:** ' + stats.claimed,
      '**Closed:** ' + stats.closed,
      '-# Open and claimed represent active tickets; closed is the historical count.'
    ].join('\n');
  } else if (action === TICKET_PANEL_ACTIONS.guide) {
    content = [
      '-# OPUS CLIENT  /  SUPPORT GUIDE',
      '## Before opening a ticket',
      '**1.** Select the category that best matches your request.',
      '**2.** Describe the issue, relevant steps and any non-sensitive details.',
      '**3.** Use the private ticket channel to communicate with ticket staff.',
      '',
      '**Priority** is reserved for urgent issues. For vulnerabilities or sensitive security reports, select **Security**.',
      '-# Never disclose passwords, access tokens or recovery codes.'
    ].join('\n');
  } else {
    throw new Error('Unknown ticket panel action: ' + action);
  }
  return {
    components: [new ContainerBuilder()
      .setAccentColor(0x8070D9)
      .addTextDisplayComponents(ticketPanelText(content))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

export async function refreshTicketPanelMessage(client) {
  const channelId = config.tickets.panelChannelId;
  if (!channelId) return null;

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('[tickets] Ticket panel channel is missing or not text-based.');
    return null;
  }

  const payload = buildTicketPanelPayload(guild.id);
  const stored = getInstallMessage(guild.id, TICKET_PANEL_MESSAGE_KEY);
  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message && message.author.id === client.user.id) {
      try {
        await message.edit(payload);
        return message;
      } catch (error) {
        console.error('[tickets] Could not edit the existing panel:', error.message);
        return null;
      }
    }
  }

  const sent = await channel.send(payload);
  setInstallMessage(guild.id, TICKET_PANEL_MESSAGE_KEY, channel.id, sent.id);
  return sent;
}

// ---------- Helpers ----------

// Staff = the configured ticket staff role, any of the extra staff roles, the mod role,
// or an administrator. staffRoleId is the legacy single-role field; staffRoleIds is the
// extensible list that can add more managing roles.
export const ticketStaffRoleIds = () =>
  [...new Set([config.tickets.staffRoleId, ...(config.tickets.staffRoleIds ?? [])].filter(Boolean))];

export function isTicketStaff(member, ticket = null) {
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  if (ticketStaffRoleIds().some(id => member.roles?.cache?.has?.(id))) return true;
  if (config.modRoleId && member.roles?.cache?.has?.(config.modRoleId)) return true;
  if (ticket && config.tickets.supportRoleId && member.roles?.cache?.has?.(config.tickets.supportRoleId)) {
    return (config.tickets.supportTypeKeys ?? []).includes(ticket.type);
  }
  return false;
}

// Every role that gets an allow overwrite on ticket channels: the staff roles + the mod
// role (deduped, only when the role exists and is not integration-managed). /install
// grants these to all open ticket channels as well.
export function ticketAccessRoleIds(guild, typeKey = null) {
  const allowedSupport = typeKey && (config.tickets.supportTypeKeys ?? []).includes(typeKey)
    ? [config.tickets.supportRoleId] : [];
  return [...new Set([...ticketStaffRoleIds(), config.modRoleId, ...allowedSupport].filter(Boolean))].filter((id) => {
    const role = guild?.roles?.cache?.get(id);
    return Boolean(role) && !role.managed;
  });
}

// The ticket row for a channel (only open tickets are actionable).
export function getTicketForChannel(guildId, channelId) {
  const row = getTicketByChannel(guildId, channelId);
  return row?.status === 'open' ? row : null;
}

// Owner of the ticket or staff - allowed to close the ticket.
export function canManageTicket(ticket, member) {
  if (!member) return false;
  return member.id === ticket.owner_id || isTicketStaff(member, ticket);
}

export function formatTicketChannelName(number, username) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid ticket number');
  const code = String(number).padStart(4, '0');
  const length = Math.max(1, 100 - code.length - 1);
  const normalized = String(username ?? 'user')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, length)
    .replace(/-+$/g, '');
  return code + '-' + (normalized || 'user');
}

// ---------- Categories ----------

// Finds or creates the per-type ticket category (config.tickets.<idKey> takes
// priority; the found/created category id is persisted back, like the roles/verify channel).
export async function ensureTicketCategory(guild, type, { reason = 'Ticket category setup' } = {}) {
  if (config.serverManagedByOpusManager) {
    const configuredId = config.tickets?.typeCategoryIds?.[type.key];
    if (!configuredId) {
      throw new Error('Ticket category not configured for ' + type.key + '. Configure the category via Opus Manager.');
    }
    const configuredCategory = await guild.channels.fetch(configuredId).catch(() => null);
    if (!configuredCategory || configuredCategory.type !== ChannelType.GuildCategory) {
      throw new Error('Ticket category missing or invalid for ' + type.key + '. Contact server staff.');
    }
    return configuredCategory;
  }
  const name = String(config.tickets?.[type.categoryNameKey] || type.defaultCategoryName);
  let category = config.tickets?.[type.categoryIdKey]
    ? await guild.channels.fetch(config.tickets[type.categoryIdKey]).catch(() => null)
    : null;
  if (!category) {
    const pool = (await guild.channels.fetch().catch(() => null)) ?? guild.channels.cache;
    category =
      pool.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
  if (!category) {
    category = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason });
    console.log(`[tickets] Created the "${category.name}" category (${category.id}).`);
  }
  if (config.tickets?.[type.categoryIdKey] !== category.id) {
    updateFileConfig({ tickets: { [type.categoryIdKey]: category.id } });
    console.log(`[tickets] Saved tickets.${type.categoryIdKey}=${category.id} to config.json.`);
  }
  return category;
}

// ---------- Archive ----------

// Legacy archive category: channels archived while the archive feature still existed
// live here (still read-only). No new tickets are archived - closes delete their
// channel. Found or created on demand (and by /install), persisted back to config.json.
export async function ensureArchiveCategory(guild, { reason = 'Ticket archive category setup' } = {}) {
  const name = String(config.tickets?.archiveCategoryName || 'Ticket Archive');
  let category = config.tickets?.archiveCategoryId
    ? await guild.channels.fetch(config.tickets.archiveCategoryId).catch(() => null)
    : null;
  if (!category) {
    const pool = (await guild.channels.fetch().catch(() => null)) ?? guild.channels.cache;
    category =
      pool.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
  if (!category) {
    const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
    for (const roleId of ticketAccessRoleIds(guild)) overwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel] });
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason,
    });
    console.log(`[tickets] Created the "${category.name}" category (${category.id}).`);
  }
  if (config.tickets?.archiveCategoryId !== category.id) {
    updateFileConfig({ tickets: { archiveCategoryId: category.id } });
    console.log(`[tickets] Saved tickets.archiveCategoryId=${category.id} to config.json.`);
  }
  return category;
}

// Read-only overwrites for legacy archived tickets: everyone loses view and send, the
// staff roles keep view-only (their allow omits SendMessages, so the @everyone deny
// stays in force for them too). New closes delete the channel outright - these
// overwrites only cover channels archived while the archive feature still existed.
function archivedTicketOverwrites(guild) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.SendMessagesInThreads,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
      ],
    },
  ];
  for (const roleId of ticketAccessRoleIds(guild)) {
    overwrites.push({
      id: roleId,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
    });
  }
  return overwrites;
}

// Re-applies the read-only seal to every remaining archived ticket channel. New closes
// delete the channel outright, so this only ever touches legacy archives from before
// the archive feature was removed; channels already denying SendMessages are skipped,
// keeping the pass idempotent. Returns { ok, failed }.
export async function sealArchivedTickets(guild, reason = 'Seal archived ticket read-only') {
  const sendFlag = PermissionsBitField.Flags.SendMessages;
  let ok = 0;
  let failed = 0;

  for (const channelId of listTicketChannelIds(guild.id)) {
    const row = getTicketByChannel(guild.id, channelId);
    if (!row || row.status === 'open') continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue; // deleted ticket channel

    // Already sealed: @everyone denies sending and no staff role re-allows it.
    const everyoneSealed = channel.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(sendFlag);
    const staffCanSend = ticketAccessRoleIds(guild).some((id) =>
      channel.permissionOverwrites.cache.get(id)?.allow.has(sendFlag),
    );
    if (everyoneSealed && !staffCanSend) continue;

    try {
      await channel.permissionOverwrites.set(archivedTicketOverwrites(guild), `${reason} (ticket #${row.id})`);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

// ---------- Transcript ----------

const TRANSCRIPT_MAX_MESSAGES = 1000;
const transcriptEscape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Walks the channel backwards in pages and returns the messages oldest-first.
async function collectTranscriptMessages(channel) {
  const collected = [];
  let before = null;
  while (collected.length < TRANSCRIPT_MAX_MESSAGES) {
    const batch = await channel.messages
      .fetch({ limit: 100, ...(before ? { before } : {}) })
      .catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return collected.reverse();
}

// Self-contained HTML transcript attachment (no external assets).
async function buildTranscriptFile(channel, ticket, member, note) {
  const messages = await collectTranscriptMessages(channel);
  const type = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.general;

  const rows = messages
    .map((message) => {
      const author = message.author ?? {
        id: message.authorId ?? 'unknown',
        tag: 'Unknown',
        displayAvatarURL: () => null,
      };
      const attachments = [...(message.attachments?.values() ?? [])]
        .map((a) => `<a href="${transcriptEscape(a.url)}">${transcriptEscape(a.name)}</a>`)
        .join(' · ');
      const embeds = message.embeds?.length ? `<div class="note">[${message.embeds.length} embed(s)]</div>` : '';
      const content = message.content
        ? transcriptEscape(message.content).replace(/\n/g, '<br>')
        : '<em class="muted">no text</em>';
      return `<div class="msg"><div class="meta"><span class="author">${transcriptEscape(
        author.tag ?? author.username ?? 'Unknown',
      )}</span> <span class="time">${new Date(message.createdTimestamp).toISOString()}</span></div><div class="content">${content}</div>${
        attachments ? `<div class="files">${attachments}</div>` : ''
      }${embeds}</div>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${transcriptEscape(channel.name)} transcript</title>
<style>
  body { background: #1e2124; color: #dcddde; font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta-header { color: #99aab5; margin-bottom: 20px; }
  .msg { padding: 10px 0; border-bottom: 1px solid #2f3136; }
  .meta { margin-bottom: 2px; }
  .author { font-weight: 600; color: #ffffff; }
  .time { color: #72767d; font-size: 12px; }
  .files a { color: #00aff4; }
  .note, .muted { color: #72767d; font-style: italic; }
</style></head>
<body>
<h1>${transcriptEscape(type.label)} • Ticket #${String(ticket.ticket_number ?? ticket.id).padStart(4, '0')} • ${transcriptEscape(channel.name)}</h1>
<div class="meta-header">Opened by ${transcriptEscape(ticket.owner_id)} • Closed by ${transcriptEscape(
    member.id,
  )} • ${new Date().toISOString()}</div>
${note ? `<div class="meta-header">Note: ${transcriptEscape(note)}</div>` : ''}
${rows || '<div class="msg"><em class="muted">No messages.</em></div>'}
</body></html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${channel.name}.html` });
}

// ---------- Ticket log channel ----------

// Posts the closure summary (opener, closer, note, channel link) plus the transcript
// attachment to tickets.logChannelId. Returns the sent message or null.
async function sendTicketLog(guild, { channel, ticket, member, note, transcript }) {
  const logChannelId = config.tickets?.logChannelId;
  if (!logChannelId) return null;

  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) {
    console.warn(`[tickets] Ticket log channel ${logChannelId} not found or not text-based.`);
    return null;
  }

  const type = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.general;
  const embed = baseEmbed(COLORS.info)
    .setTitle('Ticket Closed')
    .setDescription('**' + type.label + '** · #' + channel.name + ' (<#' + channel.id + '>)')
    .addFields(
      { name: 'Opened by', value: `<@${ticket.owner_id}>`, inline: true },
      { name: 'Closed by', value: `<@${member.id}>`, inline: true },
      { name: 'Opened', value: ts(ticket.created_at, 'F'), inline: true },
      { name: 'Closed', value: ts(Date.now(), 'F'), inline: true },
    )
    .setFooter({ text: 'Ticket #' + String(ticket.ticket_number ?? ticket.id).padStart(4, '0') })
    .setTimestamp(Date.now());
  if (ticket.purpose) embed.addFields({ name: 'Purpose', value: truncate(ticket.purpose, 600) });
  if (ticket.claimed_by) embed.addFields({ name: 'Claimed by', value: `<@${ticket.claimed_by}>` });
  if (note) embed.addFields({ name: 'Note', value: truncate(note, 400) });

  return logChannel
    .send({
      embeds: [embed],
      files: transcript ? [transcript] : [],
      allowedMentions: { parse: [] },
    })
    .then(async sent => {
      await archiveLogMessage(sent).catch(error =>
        console.error('[log-integrity] Ticket transcript archival failed:', error.message));
      return sent;
    })
    .catch((err) => {
      console.error('[tickets] Failed to post the ticket log entry:', err.message);
      return null;
    });
}

export async function logTicketActivity(guild, ticket, action, actorId, details = null) {
  const channelId = config.tickets?.logChannelId;
  if (!channelId || !guild || guild.id !== config.guildId) return null;
  const channel = guild.channels?.cache?.get?.(channelId) ??
    await guild.channels?.fetch?.(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send) return null;
  const ticketLabel = ticket
    ? '**Ticket:** #' + String(ticket.ticket_number ?? ticket.id).padStart(4, '0') +
      ' (<#' + ticket.channel_id + '>)\n**Category:** ' +
      (TICKET_TYPES[ticket.type]?.label ?? 'General') + '\n'
    : '';
  const embed = baseEmbed(COLORS.audit)
    .setTitle('Ticket ' + action)
    .setDescription(
      ticketLabel +
      '**Action by:** <@' + actorId + '>' +
      (details ? '\n**Details:** ' + truncate(details, 500) : '')
    )
    .setTimestamp(Date.now());
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch(error => {
      console.error('[tickets] Ticket activity log failed:', error.message);
      return null;
    });
}

// ---------- Open ----------

// Creates the ticket channel in the per-type category (auto-created when missing).
// Uses the GuildMember from the button interaction; reply payloads are returned for the caller.
const openingTickets = new Set();
const closingTickets = new Set();

export async function openTicket(interaction, client, typeKey = 'general', purpose = '') {
  const type = TICKET_TYPES[typeKey] ?? TICKET_TYPES.general;
  const guild = interaction.guild;
  const cleanPurpose = String(purpose).trim();
  if (!cleanPurpose || cleanPurpose.length < 10 || cleanPurpose.length > 1000) {
    return { error: 'Please provide a purpose of 10 to 1000 characters.' };
  }

  const openingKey = guild.id + ':' + interaction.user.id + ':' + type.key;
  if (openingTickets.has(openingKey)) {
    return { error: 'A ticket of this type is already being created. Please try again after it finishes.' };
  }
  openingTickets.add(openingKey);
  try {

  const existing = getOpenTicketByOwner(guild.id, interaction.user.id, type.key);
  if (existing) {
    return {
      error: `You already have an open ${type.label.toLowerCase()}: <#${existing.channel_id}>. Close it first or use that one.`,
    };
  }

  const accessRoleIds = ticketAccessRoleIds(guild, type.key);

  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
  for (const roleId of accessRoleIds) {
    overwrites.push({ id: roleId, allow: TICKET_MEMBER_ALLOW });
  }

  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    return { error: 'The bot is missing the **Manage Channels** permission - a ticket channel cannot be created.' };
  }

  const reason = `${type.label} opened by ${interaction.user.id}`;
  let category;
  try {
    category = await ensureTicketCategory(guild, type, { reason });
  } catch (error) {
    return { error: error.message };
  }
  const ticketNumber = reserveTicketNumber(guild.id);

  let channel;
  try {
    channel = await guild.channels.create({
      name: formatTicketChannelName(ticketNumber, interaction.user.username),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason,
    });
  } catch (err) {
    console.error('[tickets] Channel creation failed:', err.message);
    return { error: `Could not create the ticket channel: ${err.message}` };
  }

  // Owner allow uses the flag-object form - the array form produces an empty
  // overwrite for member entries (verified against the live API).
  try {
    await channel.permissionOverwrites.edit(interaction.user.id, TICKET_MEMBER_FLAGS, {
      reason: 'Ticket owner: ' + interaction.user.id,
    });
  } catch (error) {
    await channel.delete('Could not grant the ticket owner access').catch(() => {});
    return { error: 'Could not grant access to the ticket. Please try again.' };
  }

  let ticket;
  try {
    ticket = createTicketRow({
      guildId: guild.id,
      channelId: channel.id,
      ownerId: interaction.user.id,
      type: type.key,
      purpose: cleanPurpose,
      ticketNumber,
    });
  } catch (error) {
    await channel.delete('Could not register ticket in database').catch(() => {});
    console.error('[tickets] Ticket database insert failed:', error.message);
    return { error: 'Could not register the ticket. Please try again.' };
  }

  await refreshTicketPanelMessage(client).catch(() => {});

  // Welcome message shown to the opener: mention, staff tag and the Close button only.
  const welcome = baseEmbed(COLORS.success)
    .setTitle(type.label)
    .setDescription(
      'Opened by <@' + interaction.user.id + '>\n\n**Purpose**\n' +
      truncate(cleanPurpose, 900) +
      '\n\nA staff member can claim this ticket. Please provide any useful context or screenshots.'
    )
    .setFooter({ text: 'Opus Client Support' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(TICKET_CLAIM_BUTTON_ID).setLabel('Claim / Unclaim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(TICKET_CLOSE_BUTTON_ID).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );

  await channel
    .send({
      content: accessRoleIds.length
        ? `<@${interaction.user.id}> ${accessRoleIds.map((id) => `<@&${id}>`).join(' ')}`
        : `<@${interaction.user.id}>`,
      embeds: [welcome],
      components: [row],
      allowedMentions: {
        users: [interaction.user.id],
        roles: accessRoleIds,
      },
    })
    .catch(() => {});

  // Staff applications get the application template right away so the applicant
  // knows exactly what to fill in (embed + copyable code block).
  if (type.key === 'application') {
    await channel
      .send({
        content: `<@${interaction.user.id}>`,
        embeds: [buildApplicationEmbed()],
        allowedMentions: { users: [interaction.user.id] },
      })
      .catch((err) => console.error('[tickets] Failed to post the application template:', err.message));
  }

  await logTicketActivity(guild, ticket, 'Opened', interaction.user.id);
  return { ticket, channel };
  } finally {
    openingTickets.delete(openingKey);
  }
}

export async function claimTicket(guild, ticket, member, client, action = 'toggle') {
  if (!isTicketStaff(member, ticket)) return { error: 'Only ticket staff can claim a ticket.' };
  const result = claimTicketRow(ticket.id, member.id, action);
  if (result.error) return result;
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [
        baseEmbed(COLORS.info)
          .setDescription(result.claimed
            ? `Ticket claimed by <@${member.id}>.`
            : `Ticket unclaimed by <@${member.id}>.`)
      ],
      allowedMentions: { users: [] },
    }).catch(() => {});
  }
  await logTicketActivity(guild, ticket, result.claimed ? 'Claimed' : 'Unclaimed', member.id);
  await refreshTicketPanelMessage(client).catch(() => {});
  return result;
}

// ---------- Rename / Add / Remove / Close ----------

export async function renameTicket(guild, ticket, newName, member) {
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) return { error: 'The ticket channel no longer exists.' };
  const cleaned = String(newName).replace(/^\d{4,}-/, '').trim();
  if (!cleaned) return { error: 'The new channel name cannot be empty.' };
  const name = formatTicketChannelName(Number(ticket.ticket_number ?? ticket.id), cleaned);
  try {
    await channel.setName(name, 'Ticket renamed by ' + member.id);
  } catch (error) {
    return { error: 'Could not rename the channel: ' + error.message };
  }
  await channel.send({
    embeds: [baseEmbed(COLORS.info).setDescription('Ticket renamed to #' + name + ' by <@' + member.id + '>.')],
  }).catch(() => {});
  await logTicketActivity(guild, ticket, 'Renamed', member.id, 'New name: ' + name);
  return { channel };
}

// Accepts a Member, a Role or a raw User, adds it to the ticket overwrites and announces it.
export async function addToTicket(guild, ticket, target, member) {
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) return { error: 'The ticket channel no longer exists.' };
  const isRole = target instanceof Role || guild.roles?.cache?.has?.(target.id) === true;

  try {
    await channel.permissionOverwrites.edit(
      target.id,
      { ...TICKET_MEMBER_FLAGS, SendMessagesInThreads: true },
      {
        type: isRole ? OverwriteType.Role : OverwriteType.Member,
        reason: 'Added to ticket by ' + member.id
      }
    );
  } catch (err) {
    return { error: 'Could not update the channel permissions: ' + err.message };
  }

  const label = isRole ? '<@&' + target.id + '>' : '<@' + target.id + '>';
  await channel.send({
    embeds: [baseEmbed(COLORS.info).setDescription(label + ' was added to this ticket by <@' + member.id + '>.')],
    allowedMentions: { parse: [] }
  }).catch(() => {});
  await logTicketActivity(guild, ticket, 'Access Granted', member.id, label);
  return { channel };
}

export async function removeFromTicket(guild, ticket, target, member) {
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) return { error: 'The ticket channel no longer exists.' };
  const isRole = target instanceof Role || guild.roles?.cache?.has?.(target.id) === true;

  if (!isRole && target.id === ticket.owner_id) {
    return { error: 'The ticket owner cannot be removed from their own ticket.' };
  }
  if (!isRole && (target.id === guild.ownerId ||
      target.id === guild.members?.me?.id ||
      target.permissions?.has?.(PermissionsBitField.Flags.Administrator))) {
    return { error: 'Discord Administrators, the server owner and the bot cannot be removed by channel permissions.' };
  }

  try {
    if (isRole) {
      const preserved = ticketAccessRoleIds(guild, ticket.type).filter(id =>
        id !== target.id && (
          config.roleBranches?.staff?.includes(id) ||
          id === config.tickets.staffRoleId ||
          id === config.modRoleId
        )
      );
      for (const id of preserved) {
        const existing = channel.permissionOverwrites.cache.get(id);
        if (!existing?.allow?.has?.(PermissionsBitField.Flags.ViewChannel) ||
            existing?.deny?.has?.(PermissionsBitField.Flags.ViewChannel)) {
          await channel.permissionOverwrites.edit(
            id,
            { ...TICKET_MEMBER_FLAGS, SendMessagesInThreads: true },
            {
              type: OverwriteType.Role,
              reason: 'Preserve Staff access while removing role ' + target.id
            }
          );
        }
      }
      if (channel.permissionOverwrites.cache.has(target.id)) {
        await channel.permissionOverwrites.delete(target.id, 'Removed ticket role by ' + member.id);
      }
    } else {
      await channel.permissionOverwrites.edit(
        target.id,
        {
          ViewChannel: false,
          SendMessages: false,
          ReadMessageHistory: false,
          SendMessagesInThreads: false
        },
        {
          type: OverwriteType.Member,
          reason: 'Explicitly removed user from ticket by ' + member.id
        }
      );
    }
  } catch (err) {
    return { error: 'Could not update the channel permissions: ' + err.message };
  }

  const label = isRole ? '<@&' + target.id + '>' : '<@' + target.id + '>';
  await channel.send({
    embeds: [baseEmbed(COLORS.warn).setDescription(label + ' was removed from this ticket by <@' + member.id + '>.')],
    allowedMentions: { parse: [] }
  }).catch(() => {});
  await logTicketActivity(guild, ticket, 'Access Revoked', member.id, label);
  return { channel };
}

export async function closeTicket(guild, ticket, member, note, client) {
  if (closingTickets.has(ticket.id)) {
    return { error: 'This ticket is already being closed.' };
  }
  closingTickets.add(ticket.id);
  try {
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel) return { error: 'The ticket channel no longer exists.' };
    if (!config.tickets?.logChannelId) {
      return { error: 'Ticket logs are not configured. The ticket has been kept open.' };
    }

    await channel.send({
      embeds: [
        baseEmbed(COLORS.warn).setDescription(
          '**Ticket closure requested** by <@' + member.id + '>.\n' +
          (note ? 'Note: ' + truncate(note, 400) + '\n' : '') +
          'A transcript must be saved before this channel can be removed.'
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => {});

    const transcript = await buildTranscriptFile(channel, ticket, member, note).catch(error => {
      console.error('[tickets] Transcript generation failed:', error.message);
      return null;
    });
    if (!transcript) {
      return { error: 'Could not generate the transcript. This ticket remains open.' };
    }

    const logged = await sendTicketLog(guild, { channel, ticket, member, note, transcript });
    if (!logged) {
      return { error: 'Could not save the transcript to #ticket-logs. This ticket remains open.' };
    }

    closeTicketRow(ticket.id, { closedBy: member.id, note: note ? truncate(note, 500) : null });

    try {
      await channel.delete('Ticket closed by ' + member.id + ' with transcript saved');
    } catch (error) {
      console.error('[tickets] Could not delete the closed ticket channel:', error.message);
      return { error: 'Transcript saved, but the ticket channel could not be deleted. Contact staff.' };
    }

    await refreshTicketPanelMessage(client).catch(() => {});
    return { closed: true, channelId: channel.id };
  } finally {
    closingTickets.delete(ticket.id);
  }
}

// ---------- Staff role management (=ticketroleadd / =ticketroleremove) ----------

// Permanently adds a role to config.tickets.staffRoleIds and (re-)grants every ticket
// staff role access to all open ticket channels. Returns { stats } or { error }.
export async function addTicketStaffRole(guild, role, reason = 'Add ticket staff role') {
  if (ticketStaffRoleIds().includes(role.id)) {
    return {
      error: `The **${role.name}** role already manages tickets (it is configured as ticket staff or the mod role).`,
    };
  }
  if (role.managed) {
    return { error: `The **${role.name}** role is managed by an integration and cannot be used as ticket staff.` };
  }

  const current = Array.isArray(config.tickets.staffRoleIds) ? config.tickets.staffRoleIds : [];
  updateFileConfig({ tickets: { staffRoleIds: [...current, role.id] } });

  const stats = await applyTicketStaffOverwrites(guild, reason);
  return { stats };
}

// Removes a role from config.tickets.staffRoleIds and revokes its overwrite on all open
// ticket channels - unless the role still grants access another way (legacy
// staffRoleId or the mod role; those are kept and only the config entry is removed).
// Returns { revoked, ok, failed } or { error }.
export async function removeTicketStaffRole(guild, role, reason = 'Remove ticket staff role') {
  const current = Array.isArray(config.tickets.staffRoleIds) ? config.tickets.staffRoleIds : [];
  if (!current.includes(role.id)) {
    return {
      error: `The **${role.name}** role is not in the extensible ticket staff list (tickets.staffRoleIds in config.json).`,
    };
  }
  updateFileConfig({ tickets: { staffRoleIds: current.filter((id) => id !== role.id) } });

  // The role keeps managing tickets when it is still the legacy staff role or the mod
  // role - in that case its overwrites stay untouched.
  const stillAccess = ticketStaffRoleIds().includes(role.id);

  let ok = 0;
  let failed = 0;
  for (const channelId of listTicketChannelIds(guild.id)) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue; // deleted (already closed) ticket
    if (stillAccess) continue;
    if (!channel.permissionOverwrites.cache.has(role.id)) continue; // nothing to revoke
    try {
      await channel.permissionOverwrites.delete(role.id, reason);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { revoked: !stillAccess, ok, failed };
}

// ---------- Staff access ----------

// Grants every ticket staff role (staffRoleId + staffRoleIds + mod role) access to all
// open ticket channels. Used by /install so config changes reach existing tickets (new
// tickets always get the overwrites at creation time). Skips closed/archived channels -
// they stay sealed read-only - and deleted ones.
export async function applyTicketStaffOverwrites(guild, reason = 'Grant ticket staff access') {
  if (!ticketAccessRoleIds(guild).length && !config.tickets.supportRoleId) return { ok: 0, failed: 0, roles: 0 };

  let ok = 0;
  let failed = 0;
  for (const channelId of listTicketChannelIds(guild.id)) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue; // deleted (already closed) ticket
    if (getTicketByChannel(guild.id, channelId)?.status !== 'open') continue; // archived stays sealed
    try {
      for (const roleId of ticketAccessRoleIds(guild, getTicketByChannel(guild.id, channelId)?.type)) {
        await channel.permissionOverwrites.edit(roleId, TICKET_MEMBER_FLAGS, { reason });
      }
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed, roles: ticketAccessRoleIds(guild).length + Number(Boolean(config.tickets.supportRoleId)) };
}
