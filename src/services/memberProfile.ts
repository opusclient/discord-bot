import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { getRoleBranches } from './roleBranchPolicy.js';
import type { Guild, GuildMember, Role } from 'discord.js';
import type { RoleBranches } from './roleBranchPolicy.js';
import type { getTeamRoleHistory } from './teamRoleHistory.js';
import type { getInviteStats } from './inviteHistory.js';

type HistoryRow = ReturnType<typeof getTeamRoleHistory>['rows'][number];
type MemberProfileOptions = {
  guild: Guild;
  member: GuildMember;
  history?: ReturnType<typeof getTeamRoleHistory>;
  invites?: ReturnType<typeof getInviteStats> | null;
  showReasons?: boolean;
};


const safe = (value: unknown, limit: number = 160): string => escapeMarkdown(String(value ?? 'Unknown').slice(0, limit));
const asTime = (milliseconds: number | null | undefined): string =>
  typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds > 0
    ? '<t:' + Math.floor(milliseconds / 1000) + ':F>  ·  <t:' + Math.floor(milliseconds / 1000) + ':R>'
    : 'Not available';

const roleLabel = (role: Role | null | undefined): string => role ? '<@&' + role.id + '>' : 'None';

export function extractMemberPositions(member: GuildMember, policy: RoleBranches = getRoleBranches()) {
  const roles = member.roles.cache;
  const staffId = policy.staff.find(id => roles.has(id)) ?? null;
  const devId = policy.development.find(id => roles.has(id)) ?? null;
  return {
    staff: staffId ? roles.get(staffId) : null,
    development: devId ? roles.get(devId) : null,
    specialties: policy.specialties.filter(id => roles.has(id)).map(id => roles.get(id))
  };
}

function historyEntry(row: HistoryRow, showReason: boolean) {
  const stamp = asTime(row.created_at).split('  ·  ')[0];
  const rank = row.from_role_name && row.to_role_name
    ? safe(row.from_role_name) + ' → ' + safe(row.to_role_name)
    : row.to_role_name
      ? 'Assigned ' + safe(row.to_role_name)
      : 'Cleared ' + safe(row.branch === 'development' ? 'Development' : row.branch === 'staff' ? 'Staff' : 'role');
  const removed = row.removedRoles?.length
    ? '\n-# Removed: ' + row.removedRoles.map((role: { name: string }) => safe(role.name, 60)).join(', ').slice(0, 320)
    : '';
  const reason = showReason && row.reason
    ? '\n-# Reason: ' + safe(row.reason, 220)
    : '';
  return {
    name: (row.mode === 'promote' ? 'Promotion' : 'Demotion') + ' · ' + stamp,
    value: '**' + rank + '**\nBy <@' + row.moderator_id + '>' + removed + reason,
    inline: false
  };
}

export function buildMemberProfile({ guild, member, history = { rows: [], total: 0 }, invites = null, showReasons = false }: MemberProfileOptions) {
  const policy = getRoleBranches();
  const position = extractMemberPositions(member, policy);
  const avatar = member.displayAvatarURL?.({ size: 256 }) ??
    member.user.displayAvatarURL?.({ size: 256 }) ?? null;
  const joined = asTime(member.joinedTimestamp);
  const created = asTime(member.user.createdTimestamp);
  const positions = [
    '**Staff:** ' + roleLabel(position.staff),
    '**Development:** ' + roleLabel(position.development),
    '**Specialization:** ' + (position.specialties.length
      ? position.specialties.map(roleLabel).join(' · ') : 'None')
  ].join('\n');
  const fullRoles = [...member.roles.cache.values()]
    .filter(role => role.id !== guild.id)
    .sort((a, b) => b.position - a.position);
  const shown = fullRoles.slice(0, 12);
  const displayed = shown.length
    ? shown.map(roleLabel).join(' · ') +
      (fullRoles.length > shown.length ? '\n-# +' + (fullRoles.length - shown.length) + ' more roles' : '')
    : 'No additional server roles';
  const highlighted = position.staff ?? position.development ??
    fullRoles.find(role => role.color) ?? null;
  const embed = new EmbedBuilder()
    .setColor(highlighted?.color || 0x7383BD)
    .setAuthor({ name: safe(member.displayName || member.user.globalName || member.user.username, 150) + '  /  Member Profile', ...(avatar ? { iconURL: avatar } : {}) })
    .setTitle('Member Information')
    .setDescription([
      '<@' + member.user.id + '>  ·  ' + safe(member.user.username, 90),
      '-# ' + (member.user.bot ? 'Bot account' : 'Server member') + '  ·  ID: ' + member.user.id
    ].join('\n'))
    .addFields(
      { name: 'Joined Opus Client', value: joined, inline: false },
      { name: 'Discord Account Created', value: created, inline: false },
      { name: 'Current Positions', value: positions, inline: false },
      { name: 'Server Roles (' + fullRoles.length + ')', value: displayed.slice(0, 1024), inline: false }
    )
    .setFooter({ text: 'Opus System  ·  Member Directory' })
    .setTimestamp();
  if (avatar) embed.setThumbnail(avatar);
  if (invites) {
    embed.addFields({
      name: 'Invited Members',
      value: '**' + invites.total + '** tracked · ' + invites.present + ' still here · ' + invites.left + ' left\n' +
        (invites.since ? '-# Tracking since <t:' + Math.floor(invites.since / 1000) + ':d>' : '-# Tracking not yet initialized'),
      inline: false
    });
  }
  if (history.total) {
    embed.addFields({ name: 'Role History', value: 'Recorded promotions and demotions: **' + history.total + '** · Latest ' + history.rows.length, inline: false });
    for (const entry of history.rows) {
      const field = historyEntry(entry, showReasons);
      embed.addFields({ ...field, value: field.value.slice(0, 1024) });
    }
  } else {
    embed.addFields({
      name: 'Role History',
      value: 'No recorded promotions or demotions. Historical changes from before tracking was enabled are not included.',
      inline: false
    });
  }
  return embed;
}
