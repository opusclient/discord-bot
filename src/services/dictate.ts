import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  MentionableSelectMenuBuilder,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { config } from '../config.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  Guild,
  TextChannel
} from 'discord.js';

export type DictateDraft = {
  channelId: string;
  format: string;
  content: string;
  title?: string;
  color?: string;
  images?: string[];
};

type RoleSource = {
  roles?: { cache?: { keys(): IterableIterator<string> } } | string[];
} | null | undefined;

type DictateAccess = {
  guildId: string | null;
  guild?: { ownerId: string } | null;
  user?: { id: string } | null;
  member?: RoleSource;
};

type IdSelection = { keys(): IterableIterator<string> };
type MentionSelection = {
  users?: IdSelection | null;
  members?: IdSelection | null;
  roles?: IdSelection | null;
} | null;

type DictateSession = {
  id: string;
  guildId: string | null;
  userId: string;
  status: 'draft' | 'sending' | 'sent';
  hidden: boolean;
  expiresAt: number;
  draft: DictateDraft | null;
};

type DictateInteraction = ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

import { sendAuditLog } from './auditlog.js';

export const DICTATE_PREFIX = 'dictate:';
const TTL = 15 * 60 * 1000;
const sessions = new Map<string, DictateSession>();

function rolesOf(member: RoleSource): Set<string> {
  if (member?.roles && !Array.isArray(member.roles) && member.roles.cache) return new Set(member.roles.cache.keys());
  if (Array.isArray(member?.roles)) return new Set(member.roles);
  return new Set();
}

export function canDictate(interaction: DictateAccess | null | undefined): boolean {
  if (!interaction?.guildId || interaction.guildId !== config.guildId) return false;
  if (interaction.user?.id === interaction.guild?.ownerId) return true;
  const permitted = (config.roleBranches?.staff || []).slice(0, 3);
  return permitted.some(id => rolesOf(interaction.member).has(id));
}

function prune() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now || session.status === 'sent') sessions.delete(id);
  }
  if (sessions.size >= 100) {
    const oldest = [...sessions].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
}

export function startDictateSession(interaction: ChatInputCommandInteraction<'cached'>): string {
  prune();
  const id = randomBytes(9).toString('hex');
  sessions.set(id, {
    id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    status: 'draft',
    hidden: interaction.options?.getBoolean?.('hide') === true,
    expiresAt: Date.now() + TTL,
    draft: null
  });
  return id;
}

function textField(id: string, style: TextInputStyle, maxLength: number, placeholder: string, value: string | null | undefined, required: boolean = false): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(style)
    .setMaxLength(maxLength)
    .setRequired(required)
    .setPlaceholder(placeholder);
  if (value) input.setValue(value);
  return input;
}

export function buildDictateModal(id: string, draft: DictateDraft | null = null): ModalBuilder {
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId('dictate_channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);
  if (draft?.channelId) channel.setDefaultChannels(draft.channelId);

  const type = new StringSelectMenuBuilder()
    .setCustomId('dictate_format')
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .addOptions(
      { label: 'Embed', value: 'embed', description: 'Formatted announcement card', default: (draft?.format ?? 'embed') === 'embed' },
      { label: 'Markdown text', value: 'text', description: 'Normal Discord message with Markdown', default: draft?.format === 'text' }
    );

  const mentions = new MentionableSelectMenuBuilder()
    .setCustomId('dictate_mentions')
    .setMinValues(0)
    .setMaxValues(10)
    .setRequired(false);

  const channelTags = new ChannelSelectMenuBuilder()
    .setCustomId('dictate_tag_channels')
    .setMinValues(0)
    .setMaxValues(10)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(DICTATE_PREFIX + 'modal:' + id)
    .setTitle('Opus System · Dictate')
    .addLabelComponents(
      new LabelBuilder().setLabel('Target channel').setChannelSelectMenuComponent(channel),
      new LabelBuilder().setLabel('Message format').setStringSelectMenuComponent(type),
      new LabelBuilder().setLabel('Add Member/Role (optional)').setMentionableSelectMenuComponent(mentions),
      new LabelBuilder().setLabel('Add Channel (optional)').setChannelSelectMenuComponent(channelTags),
      new LabelBuilder().setLabel('Content (optional when adding tags)').setDescription('Select tags, then Submit and press Edit Content to place them anywhere.').setTextInputComponent(
        textField('dictate_content', TextInputStyle.Paragraph, 4000, 'Write your message here, or select tags above', draft?.content, false)
      )
    );
}

export function buildDictateMentionModal(id: string): ModalBuilder {
  const mentions = new MentionableSelectMenuBuilder()
    .setCustomId('dictate_mentions')
    .setMinValues(0)
    .setMaxValues(10)
    .setRequired(false);
  const channels = new ChannelSelectMenuBuilder()
    .setCustomId('dictate_tag_channels')
    .setMinValues(0)
    .setMaxValues(10)
    .setRequired(false);
  return new ModalBuilder()
    .setCustomId(DICTATE_PREFIX + 'mentions-modal:' + id)
    .setTitle('Add mentions and channels')
    .addLabelComponents(
      new LabelBuilder().setLabel('Add Member/Role (optional)').setMentionableSelectMenuComponent(mentions),
      new LabelBuilder().setLabel('Add Channel (optional)').setChannelSelectMenuComponent(channels)
    );
}

export function buildDictateColorModal(id: string, draft: Partial<DictateDraft> | string = {}): ModalBuilder {
  const title = typeof draft === 'string' ? '' : draft.title || '';
  const color = typeof draft === 'string' ? draft : draft.color || '';
  return new ModalBuilder()
    .setCustomId(DICTATE_PREFIX + 'color-modal:' + id)
    .setTitle('Embed settings')
    .addLabelComponents(
      new LabelBuilder().setLabel('Embed title (optional)').setTextInputComponent(
        textField('dictate_title', TextInputStyle.Short, 256, 'Leave blank for no title', title)
      ),
      new LabelBuilder().setLabel('Embed color (optional)').setTextInputComponent(
        textField('dictate_color', TextInputStyle.Short, 7, '#5865F2', color)
      )
    );
}

export function appendDictateMentions(draft: DictateDraft, selection: MentionSelection, guildId: string | null): DictateDraft {
  const users = new Set([
    ...Array.from(selection?.users?.keys?.() || []),
    ...Array.from(selection?.members?.keys?.() || [])
  ]);
  const roles = new Set(selection?.roles?.keys?.() || []);
  const tokens = [
    ...[...users].filter(id => /^\d{16,23}$/.test(id)).map(id => '<@' + id + '>'),
    ...[...roles].filter(id => /^\d{16,23}$/.test(id) && id !== guildId).map(id => '<@&' + id + '>')
  ];
  const additions = tokens.filter(token => !draft.content.includes(token));
  return { ...draft, content: draft.content + (additions.length ? (draft.content.trim() ? '\n' : '') + additions.join(' ') : '') };
}

export function appendDictateChannelMentions(draft: DictateDraft, selectedChannels: IdSelection | null): DictateDraft {
  const ids = [...new Set(Array.from(selectedChannels?.keys?.() || []))];
  const tokens = ids
    .filter(id => /^\d{16,23}$/.test(id))
    .map(id => '<#' + id + '>');
  const additions = tokens.filter(token => !draft.content.includes(token));
  return {
    ...draft,
    content: draft.content + (additions.length ? (draft.content.trim() ? '\n' : '') + additions.join(' ') : '')
  };
}

export function appendDictateReferences(draft: DictateDraft, selectedMentions: MentionSelection, selectedChannels: IdSelection | null, guildId: string | null): DictateDraft {
  return appendDictateChannelMentions(
    appendDictateMentions(draft, selectedMentions, guildId),
    selectedChannels
  );
}

export function validateDictateDraft(draft: DictateDraft | null | undefined): string | null {
  if (!/^\d{16,23}$/.test(draft?.channelId || '')) return 'Choose a valid destination channel.';
  if (!['embed', 'text'].includes(draft?.format ?? '')) return 'Choose Embed or Markdown text.';
  if (typeof draft?.content !== 'string') return 'Invalid message content.';
  if (!draft.content.trim() && !draft.images?.length) return 'Add a message or at least one image.';
  if (draft.format === 'text' && draft.content.length > 2000) return 'Markdown text is limited to 2,000 characters.';
  if (draft.format === 'embed' && draft.content.length > 4000) return 'Embed content is limited to 4,000 characters.';
  if (draft.title && draft.title.length > 256) return 'The embed title cannot exceed 256 characters.';
  if (draft.format === 'embed' && draft.color && !/^#[0-9a-fA-F]{6}$/.test(draft.color)) {
    return 'Embed color must be a 6-digit hex value, such as #5865F2.';
  }
  return null;
}

export function buildDictateMessage(draft: DictateDraft) {
  const users = [...new Set([...draft.content.matchAll(/<@!?(\d{16,23})>/g)].map(match => match[1]))].slice(0, 100);
  const roles = [...new Set([...draft.content.matchAll(/<@&(\d{16,23})>/g)].map(match => match[1]))].filter(id => id !== config.guildId).slice(0, 100);
  const allowedMentions = { parse: [], users, roles, repliedUser: false };
  if (draft.format === 'text') {
    return { content: draft.content || null, allowedMentions };
  }
  const embed = new EmbedBuilder()
    .setColor(draft.color ? Number.parseInt(draft.color.slice(1), 16) : 0x5865F2);
  if (draft.content.trim()) embed.setDescription(draft.content);
  if (draft.title?.trim()) embed.setTitle(draft.title.trim());
  return { content: null, embeds: [embed], allowedMentions };
}

export function buildDictatePreview(id: string, draft: DictateDraft, { hidden = false }: { hidden?: boolean } = {}) {
  const summary = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Dictate · Ready to publish')
    .setDescription('Destination: <#' + draft.channelId + '>\nFormat: **' +
      (draft.format === 'embed' ? 'Embed' : 'Markdown text') +
      '**\nSelected tags were appended to the end of Content. Use **Edit Content** to move them before publishing. ' +
      (hidden ? 'Only you can see this preview.' : 'Others can view this preview, but only you can publish it.'));
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(DICTATE_PREFIX + 'send:' + id).setLabel('Publish').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(DICTATE_PREFIX + 'edit:' + id).setLabel('Edit Content').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(DICTATE_PREFIX + 'mentions:' + id).setLabel('Add Tags').setStyle(ButtonStyle.Primary),
    ...(draft.format === 'embed' ? [
      new ButtonBuilder().setCustomId(DICTATE_PREFIX + 'color:' + id).setLabel('Embed Settings').setStyle(ButtonStyle.Secondary)
    ] : []),
    new ButtonBuilder().setCustomId(DICTATE_PREFIX + 'cancel:' + id).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
  const message = buildDictateMessage(draft);
  return {
    content: message.content ?? null,
    embeds: [summary, ...(message.embeds || [])],
    components: [controls],
    allowedMentions: { parse: [] }
  };
}

async function getTarget(interaction: DictateInteraction, draft: DictateDraft): Promise<{ error: string; channel?: never } | { channel: TextChannel; error?: never }> {
  const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return { error: 'This channel no longer exists or is not a supported text channel.' };
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const bot = interaction.guild.members.me ??
    await interaction.guild.members.fetchMe().catch(() => null);
  if (!member || !channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel)) {
    return { error: 'You must be able to view the destination channel.' };
  }
  if (!bot || !channel.permissionsFor(bot)?.has(PermissionsBitField.Flags.SendMessages) ||
      !channel.permissionsFor(bot)?.has(PermissionsBitField.Flags.ViewChannel)) {
    return { error: 'Opus System cannot send messages to that channel.' };
  }
  if ([config.auditLogChannelId, config.modLogChannelId, config.logChannels?.automodChannelId,
    config.logChannels?.blacklistChannelId, config.tickets?.logChannelId].includes(channel.id)) {
    return { error: 'System log channels cannot be used as a /dictate destination.' };
  }
  return { channel: channel as TextChannel };
}

function readDraft(interaction: ModalSubmitInteraction<'cached'>, previous: DictateDraft | null = null): DictateDraft {
  const channel = interaction.fields.getSelectedChannels('dictate_channel')?.first();
  const draft = {
    channelId: channel?.id || '',
    format: interaction.fields.getStringSelectValues('dictate_format')?.[0] || '',
    content: interaction.fields.getTextInputValue('dictate_content') || '',
    title: previous?.title || '',
    color: previous?.color || ''
  };
  const mentions = interaction.fields.getSelectedMentionables('dictate_mentions');
  const channels = interaction.fields.getSelectedChannels('dictate_tag_channels');
  return appendDictateReferences(draft, mentions, channels, interaction.guildId);
}

function replyError(interaction: DictateInteraction, message: string) {
  return interaction.reply({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

function sessionFor(interaction: DictateInteraction, id: string): DictateSession | null {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) return null;
  return session;
}

export async function handleDictateInteraction(interaction: DictateInteraction): Promise<boolean> {
  if (!interaction.customId?.startsWith(DICTATE_PREFIX)) return false;
  const parts = interaction.customId.split(':');
  if (parts.length !== 3) return false;
  const [, action, id] = parts;
  if (!['modal', 'send', 'edit', 'mentions', 'mentions-modal', 'color', 'color-modal', 'cancel'].includes(action)) return false;
  if (!canDictate(interaction)) {
    await replyError(interaction, 'Only Administrator, Manager, or Founder can use /dictate.');
    return true;
  }
  const session = sessionFor(interaction, id);
  if (!session) {
    await replyError(interaction, 'This editor has expired or belongs to another user. Run /dictate again.');
    return true;
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    if (session.status !== 'draft') {
      await replyError(interaction, 'This draft has already been submitted.');
      return true;
    }
    const draft = readDraft(interaction, session.draft);
    const invalid = validateDictateDraft(draft);
    if (invalid) {
      await replyError(interaction, invalid + ' Open /dictate again, or use Edit on your previous preview.');
      return true;
    }
    session.draft = draft;
    session.expiresAt = Date.now() + TTL;
    const payload = buildDictatePreview(id, draft, { hidden: session.hidden });
    if (interaction.isFromMessage()) {
      await interaction.update(payload);
    } else {
      await interaction.reply({ ...payload, flags: session.hidden ? MessageFlags.Ephemeral : 0 } as unknown as import('discord.js').InteractionReplyOptions);
    }
    return true;
  }
  if (action === 'mentions-modal' && interaction.isModalSubmit()) {
    if (!session.draft || session.status !== 'draft') {
      await replyError(interaction, 'This draft is no longer available.');
      return true;
    }
    const selection = interaction.fields.getSelectedMentionables('dictate_mentions');
    const channels = interaction.fields.getSelectedChannels('dictate_tag_channels');
    const updated = appendDictateReferences(session.draft, selection, channels, interaction.guildId);
    if (updated.content === session.draft.content) {
      await replyError(interaction, 'No new mentions or channels were selected.');
      return true;
    }
    const invalid = validateDictateDraft(updated);
    if (invalid) {
      await replyError(interaction, invalid + ' Remove some text or mentions and try again.');
      return true;
    }
    session.draft = updated;
    session.expiresAt = Date.now() + TTL;
    const payload = buildDictatePreview(id, updated, { hidden: session.hidden });
    if (interaction.isFromMessage()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: session.hidden ? MessageFlags.Ephemeral : 0 } as unknown as import('discord.js').InteractionReplyOptions);
    return true;
  }
  if (action === 'color-modal' && interaction.isModalSubmit()) {
    if (!session.draft || session.status !== 'draft' || session.draft.format !== 'embed') {
      await replyError(interaction, 'This embed draft is no longer editable.');
      return true;
    }
    const updated = {
      ...session.draft,
      title: interaction.fields.getTextInputValue('dictate_title').trim(),
      color: interaction.fields.getTextInputValue('dictate_color').trim()
    };
    const invalid = validateDictateDraft(updated);
    if (invalid) {
      await replyError(interaction, invalid);
      return true;
    }
    session.draft = updated;
    session.expiresAt = Date.now() + TTL;
    const payload = buildDictatePreview(id, updated, { hidden: session.hidden });
    if (interaction.isFromMessage()) await interaction.update(payload);
    else await interaction.reply({ ...payload, flags: session.hidden ? MessageFlags.Ephemeral : 0 } as unknown as import('discord.js').InteractionReplyOptions);
    return true;
  }
  if (!interaction.isButton()) return false;
  if (action === 'color') {
    if (!session.draft || session.status !== 'draft' || session.draft.format !== 'embed') {
      await replyError(interaction, 'This embed draft is no longer editable.');
      return true;
    }
    await interaction.showModal(buildDictateColorModal(id, session.draft));
    return true;
  }
  if (action === 'mentions') {
    if (!session.draft || session.status !== 'draft') {
      await replyError(interaction, 'This draft cannot be edited.');
      return true;
    }
    await interaction.showModal(buildDictateMentionModal(id));
    return true;
  }
  if (action === 'edit') {
    if (!session.draft || session.status !== 'draft') {
      await replyError(interaction, 'This draft cannot be edited.');
      return true;
    }
    await interaction.showModal(buildDictateModal(id, session.draft));
    return true;
  }
  if (action === 'cancel') {
    if (session.status !== 'draft') {
      await replyError(interaction, 'This draft has already been submitted.');
      return true;
    }
    sessions.delete(id);
    await interaction.update({ content: 'Dictate draft cancelled. Nothing was posted.', embeds: [], components: [] });
    return true;
  }
  if (action === 'send') {
    if (!session.draft || session.status !== 'draft') {
      await replyError(interaction, 'This draft has already been submitted or is no longer available.');
      return true;
    }
    session.status = 'sending';
    await interaction.deferUpdate();
    try {
      const target = await getTarget(interaction, session.draft);
      if (!target.channel) throw new Error(target.error ?? 'Destination channel is unavailable');
      const sent = await target.channel.send(buildDictateMessage(session.draft) as unknown as import('discord.js').MessageCreateOptions);
      session.status = 'sent';
      const log = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Dictate Published')
        .addFields(
          { name: 'Published by', value: '<@' + interaction.user.id + '>', inline: true },
          { name: 'Destination', value: '<#' + target.channel.id + '>', inline: true },
          { name: 'Format', value: session.draft.format, inline: true },
          { name: 'Message', value: '[Open published message](' + sent.url + ')' }
        )
        .setFooter({ text: 'Message ID: ' + sent.id })
        .setTimestamp();
      const audit = await sendAuditLog(interaction.guild, log);
      await interaction.editReply({
        content: 'Published successfully to <#' + target.channel.id + '>. [View message](' + sent.url + ')' +
          (audit ? '' : '\nWarning: The audit log could not be written.'),
        embeds: [],
        components: [],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      session.status = 'draft';
      console.error('[dictate] Publish failed:', (error instanceof Error ? error.message : String(error)));
      await interaction.editReply({
        content: 'Could not publish: ' + ((error instanceof Error ? error.message : String(error)) || 'unknown error'),
        embeds: [],
        components: buildDictatePreview(id, session.draft, { hidden: session.hidden }).components
      });
    }
    return true;
  }
  return false;
}
