import { EmbedBuilder } from 'discord.js';
import type { User } from 'discord.js';

export type PunishmentCase = {
  type: string;
  status: string;
  moderator_id: string;
  case_number: number;
  created_at: number;
  reason?: string | null;
  expires_at?: number | null;
  duration_ms?: number | null;
  user_id: string;
};

type UserPreview = Pick<User, 'username' | 'displayAvatarURL'>;
type TargetPreview = Pick<User, 'id' | 'displayAvatarURL'>;

type PunishmentsEmbedOptions = {
  user: UserPreview;
  cases: PunishmentCase[];
  page: number;
  totalPages: number;
  total: number;
  guildName: string;
  clientId?: string | null;
};

type ActionEmbedOptions = {
  action: string;
  target: TargetPreview;
  roleId?: string | null;
  durationMs?: number | null;
  reason?: string | null;
  guildName?: string | null;
};

type AuditEmbedOptions = {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};
import { CASE_STATUS, COLORS, TYPE_META } from '../constants.js';
import { formatDuration, formatDurationCompact } from './duration.js';

export const ts = (ms: number, style: string = 'F'): string => `<t:${Math.floor(ms / 1000)}:${style}>`;
export const rel = (ms: number): string => ts(ms, 'R');

export const baseEmbed = (color: number = COLORS.info): EmbedBuilder => new EmbedBuilder().setColor(color);

export const successEmbed = (description: string, title: string = 'Success'): EmbedBuilder =>
  baseEmbed(COLORS.success).setTitle(title).setDescription(description);

export const errorEmbed = (description: string, title: string = 'Action failed'): EmbedBuilder =>
  baseEmbed(COLORS.error).setTitle(title).setDescription(description);

export const infoEmbed = (title: string, description: string): EmbedBuilder => baseEmbed(COLORS.info).setTitle(title).setDescription(description);

const typeMeta = (caseRow: PunishmentCase) => TYPE_META[caseRow.type as keyof typeof TYPE_META] ?? TYPE_META.note;

const statusLabel = (caseRow: PunishmentCase): string => {
  const status = CASE_STATUS[caseRow.status as keyof typeof CASE_STATUS] ?? CASE_STATUS.removed;
  return status.label;
};

const staffMention = (caseRow: PunishmentCase, clientId: string | null): string =>
  caseRow.moderator_id === 'system' || (clientId && caseRow.moderator_id === clientId)
    ? 'System (automatic)'
    : `<@${caseRow.moderator_id}>`;

// One punishment block, e.g.:
// ● **MUTE** ( `#9887` ) | 10 days ago
// > **Status:** Active
// > **Reason:** Negative Use of Disabilities
// > **Staff:** @MaxGamer
// > **Expires:** in 11 days
// Collapses newlines (so single-line markdown like "> ..." never breaks) and hard-caps the length
// so long user input can never overflow an embed description limit.
export const truncate = (text: unknown, max: number): string => {
  const clean = String(text).replace(/[\r\n]+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
};

export function punishmentEntry(caseRow: PunishmentCase, { clientId = null }: { clientId?: string | null } = {}): string {
  const meta = typeMeta(caseRow);
  const lines = [
    `● **${meta.label}** ( \`#${caseRow.case_number}\` ) | ${rel(caseRow.created_at)}`,
    `> **Status:** ${statusLabel(caseRow)}`,
  ];
  const reason = truncate(caseRow.reason || 'No reason provided', 150);
  lines.push(`> **Reason:** ${reason}`);
  lines.push(`> **Staff:** ${staffMention(caseRow, clientId)}`);
  if (caseRow.expires_at) lines.push(`> **Expires:** ${rel(caseRow.expires_at)}`);
  return lines.join('\n');
}

// Punishments history embed (matches the "Punishments • user • Page x of y" style).
export function buildPunishmentsEmbed({ user, cases, page, totalPages, total, guildName, clientId = null }: PunishmentsEmbedOptions): EmbedBuilder {
  const embed = baseEmbed(COLORS.info)
    .setTitle(`Punishments • ${user.username} • Page ${page + 1} of ${totalPages}`)
    .setDescription(cases.map((c) => punishmentEntry(c, { clientId })).join('\n\n'))
    .setFooter({ text: `${guildName} • Page ${page + 1}/${totalPages} • Total: ${total}` })
    .setTimestamp(Date.now());
  const avatar = user.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

const ACTION_TITLES = {
  mute: 'User Muted',
  unmute: 'User Unmuted',
  kick: 'User Kicked',
  ban: 'User Banned',
  unban: 'User Unbanned',
  warn: 'User Warned',
  note: 'Note Added',
  alert: 'Alert',
  addrole: 'Role Added',
  removerole: 'Role Removed',
};

// Action confirmation embed (matches the "User Muted" style).
export function buildActionEmbed({ action, target, roleId = null, durationMs = null, reason = null, guildName = null }: ActionEmbedOptions): EmbedBuilder {
  const meta = TYPE_META[action as keyof typeof TYPE_META] ?? TYPE_META.note;
  const mention = `<@${target.id}>`;
  let sentence;
  switch (action) {
    case 'mute':
      sentence = durationMs ? `Muted ${mention} for **${formatDurationCompact(durationMs)}**.` : `Muted ${mention} permanently.`;
      break;
    case 'ban':
      sentence = durationMs ? `Banned ${mention} for **${formatDurationCompact(durationMs)}**.` : `Banned ${mention} permanently.`;
      break;
    case 'unmute':
      sentence = `Unmuted ${mention}.`;
      break;
    case 'unban':
      sentence = `Unbanned ${mention}.`;
      break;
    case 'kick':
      sentence = `Kicked ${mention}.`;
      break;
    case 'warn':
      sentence = `Warned ${mention}.`;
      break;
    case 'addrole':
      sentence = `Gave ${mention} the ${roleId ? `<@&${roleId}>` : 'role'}.`;
      break;
    case 'removerole':
      sentence = `Removed the ${roleId ? `<@&${roleId}>` : 'role'} from ${mention}.`;
      break;
    default:
      sentence = `${mention}`;
  }
  const lines = [sentence];
  if (reason) lines.push(`**Reason:** ${truncate(reason, 300)}`);

  const embed = baseEmbed(meta.color)
    .setTitle(ACTION_TITLES[action as keyof typeof ACTION_TITLES] ?? 'Action applied')
    .setDescription(lines.join('\n'))
    .setTimestamp(Date.now());
  const avatar = target.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (avatar) embed.setThumbnail(avatar);
  if (guildName) embed.setFooter({ text: guildName });
  return embed;
}

// Detailed single-case embed (used by /case view).
export function buildCaseEmbed(caseRow: PunishmentCase, { clientId = null }: { clientId?: string | null } = {}): EmbedBuilder {
  const meta = typeMeta(caseRow);
  const lines = [
    `**Status:** ${statusLabel(caseRow)}`,
    `**User:** <@${caseRow.user_id}>`,
    `**Staff:** ${staffMention(caseRow, clientId)}`,
  ];
  if (caseRow.reason) lines.push(`**Reason:** ${truncate(caseRow.reason, 500)}`);
  if (caseRow.duration_ms) lines.push(`**Duration:** ${formatDuration(caseRow.duration_ms)}`);
  if (caseRow.expires_at) lines.push(`**Expires:** ${ts(caseRow.expires_at, 'F')} (${rel(caseRow.expires_at)})`);
  lines.push(`**Created:** ${ts(caseRow.created_at, 'F')}`);

  return baseEmbed(meta.color)
    .setTitle(`Case #${caseRow.case_number} • ${meta.label}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `User ID: ${caseRow.user_id}` })
    .setTimestamp(caseRow.created_at);
}

// Generic embed for mod log / audit log entries.
export function buildAuditEmbed({ title, description, color = COLORS.audit, fields = [] }: AuditEmbedOptions): EmbedBuilder {
  const embed = baseEmbed(color).setTitle(title).setDescription(description).setTimestamp(Date.now());
  if (fields.length) embed.addFields(fields);
  return embed;
}
