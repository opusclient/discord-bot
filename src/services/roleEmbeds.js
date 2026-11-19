import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown
} from 'discord.js';
import { config } from '../config.js';
import { COLORS } from '../constants.js';
import { baseEmbed, truncate } from '../utils/embeds.js';

export const ROLE_RESULTS_PER_PAGE = 5;

const TITLES = {
  add: 'Role assigned',
  remove: 'Role removed',
  promote: 'Staff promotion',
  demote: 'Staff demotion'
};

const LABELS = {
  add: 'ROLE ASSIGNMENT',
  remove: 'ROLE REMOVAL',
  promote: 'STAFF PROMOTION',
  demote: 'STAFF DEMOTION'
};

const COLORS_BY_MODE = {
  add: COLORS.success,
  remove: COLORS.gray,
  promote: 0x65C8AC,
  demote: 0xE9A15D
};

const safe = (value, limit = 220) => truncate(escapeMarkdown(String(value ?? 'Unknown')), limit);
const monospace = value => String.fromCharCode(96) + value + String.fromCharCode(96);
const roleName = role => role ? safe(role.name, 140) : 'Not specified';
const roleLabel = role => role ? '**' + roleName(role) + '**' : 'Not specified';

const roleIds = (fromRole, toRole) => fromRole && toRole
  ? monospace(fromRole.id) + ' → ' + monospace(toRole.id)
  : monospace((fromRole ?? toRole).id);

const statusText = mode => ({
  add: 'This role is now assigned to your account.',
  remove: 'This role has been removed from your account.',
  promote: 'Your new staff position is now active.',
  demote: 'Your staff position has been updated.'
})[mode] ?? 'Your account roles have been updated.';

export function ticketPanelUrl(guildId, panelId = config.tickets?.panelChannelId) {
  if (!/^\d{17,20}$/.test(String(guildId ?? ''))) return null;
  if (!/^\d{17,20}$/.test(String(panelId ?? ''))) return null;
  return 'https://discord.com/channels/' + guildId + '/' + panelId;
}

export function buildRoleNotification({ member, fromRole, toRole, removedRoles = [], addedRoles = [], family = null, regularMember = false, mode, guild, moderator, reason, referenceId, timestamp = Date.now() }) {
  const transition = mode === 'promote' || mode === 'demote';
  const guildName = safe(guild.name, 120);
  const icon = guild.iconURL?.({ size: 256 });
  const headingText =
    '-# ' + guildName.toUpperCase() + '  /  OFFICIAL NOTICE\n' +
    '## ' + (TITLES[mode] ?? 'Account update') + '\n' +
    statusText(mode);
  const container = new ContainerBuilder().setAccentColor(COLORS_BY_MODE[mode] ?? COLORS.info);
  if (icon) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText));
  }

  container.addSeparatorComponents(separator => separator);
  if (transition) {
    const heading = mode === 'demote' && !toRole
      ? (regularMember ? 'Regular Member' : family === 'staff' ? 'Staff Branch Cleared' : family === 'development' ? 'Development Branch Cleared' : 'Role Removed')
      : roleName(toRole);
    const details = mode === 'demote' && !toRole
      ? 'Previous position: ' + roleLabel(fromRole)
      : mode === 'promote' && !fromRole
        ? 'New position assigned. Other independent roles were retained.'
        : (mode === 'promote' ? 'Promoted from ' : 'Previously ') + roleLabel(fromRole);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '-# POSITION UPDATE\n' +
        '## ' + heading + '\n' +
        details + '\n\n' +
        '-# Role IDs: ' + roleIds(fromRole, toRole)
      )
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '-# ' + (mode === 'add' ? 'ASSIGNED ROLE' : 'REMOVED ROLE') + '\n' +
        '## ' + roleName(toRole) + '\n' +
        '-# Role ID: ' + monospace(toRole.id)
      )
    );
  }
  if (removedRoles.length) {
    container.addSeparatorComponents(separator => separator);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Roles removed (' + removedRoles.length + ')**\n' +
        removedRoles.map(role => '• ' + roleName(role)).join('\n')
      )
    );
  }
  if (reason?.trim()) {
    container.addSeparatorComponents(separator => separator);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Reason**\n' + safe(reason, 650))
    );
  }
  container.addSeparatorComponents(separator => separator);
  const moderatorName = moderator.globalName || moderator.username || moderator.tag || moderator.id;
  const date = '<t:' + Math.floor(timestamp / 1000) + ':f>';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '**Authorized by**  ' + safe(moderatorName, 100) + '\n' +
      '-# ' + date + (referenceId ? '  ·  Ref ' + monospace(safe(referenceId, 64)) : '')
    )
  );
  const url = ticketPanelUrl(guild.id);
  if (url) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('-# Need clarification? Contact the Opus support team.')
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Support Ticket').setURL(url)
      )
    );
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] }
  };
}

const countStatus = (records, status) => records.filter(record => record.status === status).length;

const remediation = error => {
  if (error?.includes('Member does not have the source role')) {
    return 'Select the role currently held by the member in ' + monospace('from_role') + '.';
  }
  if (error?.includes('This role is already assigned')) {
    return 'The member already has this role. Choose another role or specify a role to replace.';
  }
  if (error?.includes('staff-role list') || error?.includes('not a staff role')) {
    return 'Choose an existing staff role for ' + monospace('from_role') + '.';
  }
  return null;
};

function recordValue(record, mode, audit = false) {
  const user = '<@' + record.id + '>';
  const recordId = audit ? '\n-# Member ID: ' + monospace(record.id) : '';
  if (record.status !== 'success') {
    const explanation = safe(record.error || 'The requested change could not be applied.', 250);
    const nextStep = remediation(record.error);
    return user + '\n' +
      '**No role changes applied**\n' +
      '> ' + explanation +
      (nextStep ? '\n**Next step:** ' + nextStep : '') + recordId;
  }
  const change = mode === 'promote' && !record.fromRole
    ? 'Assigned ' + roleLabel(record.toRole)
    : mode === 'demote' && !record.toRole
      ? roleLabel(record.fromRole) + '  →  ' + (record.regularMember ? '**Regular Member**' : '**' + (record.family === 'staff' ? 'Staff Branch Cleared' : record.family === 'development' ? 'Development Branch Cleared' : 'Role Removed') + '**')
      : mode === 'promote' || mode === 'demote'
        ? roleLabel(record.fromRole) + '  →  ' + roleLabel(record.toRole)
        : (mode === 'add' ? 'Assigned ' : 'Removed ') + roleLabel(record.toRole);
  const removed = record.removedRoles ?? [];
  const extra = removed.length ? '\n**Roles removed (' + removed.length + '):** ' + removed.map(roleName).join(', ') : '';
  return user + '\n' + change + extra + '\n' +
    '-# Notification: ' + (record.dmDelivered ? 'Delivered via DM' : 'DM unavailable') + recordId;
}

export function buildRoleOperationResult({ mode, guild, moderator, reason, records, page = 0, referenceId, timestamp = Date.now(), audit = false }) {
  const success = countStatus(records, 'success');
  const failed = records.length - success;
  const dmFailed = records.filter(record => record.status === 'success' && !record.dmDelivered).length;
  const dmDelivered = success - dmFailed;
  const pages = Math.max(1, Math.ceil(records.length / ROLE_RESULTS_PER_PAGE));
  const current = Math.max(0, Math.min(page, pages - 1));
  const result = failed === 0 ? 'COMPLETED' : success === 0 ? 'FAILED' : 'PARTIAL SUCCESS';
  const title = LABELS[mode] ?? 'ROLE UPDATE';
  const color = failed === 0 && dmFailed === 0 ? COLORS_BY_MODE[mode] ?? COLORS.success :
    success === 0 ? COLORS.error : COLORS.mute;
  const icon = guild.iconURL?.({ size: 128 });
  const embed = baseEmbed(color)
    .setAuthor({ name: 'OPUS CLIENT  /  TEAM OPERATIONS', ...(icon ? { iconURL: icon } : {}) })
    .setTitle(title + '  ·  ' + result)
    .setDescription(
      '## ' + success + ' / ' + records.length + ' changes applied\n' +
      (failed
        ? '**' + failed + '** failed or skipped. No changes were made to those members.'
        : dmFailed ? 'Role updates succeeded; **' + dmFailed + '** DM notification(s) could not be delivered.'
          : 'All requested role changes were applied successfully.') +
      '\n\n-# ' + dmDelivered + ' DM delivered' + (dmFailed ? ' · ' + dmFailed + ' unavailable' : '') +
      '  ·  Requested by <@' + moderator.id + '>' +
      (reason ? '\n**Reason:** ' + safe(reason, 350) : '')
    )
    .setTimestamp(timestamp);

  const visible = records.slice(current * ROLE_RESULTS_PER_PAGE, (current + 1) * ROLE_RESULTS_PER_PAGE);
  for (const [index, record] of visible.entries()) {
    const position = current * ROLE_RESULTS_PER_PAGE + index + 1;
    embed.addFields({
      name: String(position).padStart(2, '0') + '  ' + (record.status === 'success' ? '✓' : '✕') + '  ' + safe(record.name || record.id, 135),
      value: recordValue(record, mode, audit),
      inline: false
    });
  }
  embed.setFooter({
    text: 'Opus System  ·  ' + (current + 1) + '/' + pages +
      (referenceId ? '  ·  Ref ' + referenceId : '') +
      (audit ? '  ·  Audit' : '')
  });
  return embed;
}
