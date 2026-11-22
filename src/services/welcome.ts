// Welcome card posted in the configured channel when a human member joins.
// Style: our own embed (no emoji) - mention line, rules reminder, details
// block (user ID, verification status / role, join date) and the live member count.
import { config } from '../config.js';
import type { GuildMember } from 'discord.js';
import type { CaseRecord } from '../db.js';
import { COLORS, TYPE_META } from '../constants.js';
import { baseEmbed, rel, truncate, ts } from '../utils/embeds.js';
import { isVerifyEnabled } from './verify.js';

export function buildWelcomeCard(member: GuildMember, { verifyChannelName = null }: { verifyChannelName?: string | null } = {}) {
  const memberCount = member.guild.memberCount;
  const roleLine = isVerifyEnabled()
    ? `Status   · Awaiting verification (press Verify in #${verifyChannelName || config.verify?.channelName || 'verify'})`
    : `Role     · ${config.verifiedRoleName || 'Verified'} (auto-assigned)`;
  // With verification enabled the card points newcomers at the verify channel.
  const verifyLine = isVerifyEnabled() && config.verify?.channelId
    ? `<#${config.verify.channelId}> is where you complete verification to unlock Opus community and product channels.`
    : null;
  return baseEmbed(COLORS.success)
    .setTitle(`Welcome, ${member.user.username}`)
    .setDescription(
      [
        'Please read <#1566418277423513670> and enjoy your stay.',
        verifyLine,
        '',
        '**[ • ] Details**',
        '```',
        `User ID  · ${member.id}`,
        roleLine,
        '```',
        `Joined · ${ts(Date.now())} (${rel(Date.now())})`,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `We now have ${memberCount} member${memberCount === 1 ? '' : 's'}!`, iconURL: member.guild.iconURL({ size: 64 }) ?? undefined });
}

// Sends the welcome card; silently skipped when disabled or the channel is gone.
export async function sendWelcome(member: GuildMember) {
  const channelId = config.welcome?.channelId;
  if (!channelId || member.user.bot) return;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) return;

  // With verification enabled the card points the new member at the verify channel.
  let verifyChannelName = null;
  if (isVerifyEnabled()) {
    verifyChannelName = (await member.guild.channels.fetch(config.verify.channelId).catch(() => null))?.name ?? null;
  }

  const card = buildWelcomeCard(member, { verifyChannelName });
  await channel
    .send({
      content: `<@${member.id}>, Welcome to ${member.guild.name}!`,
      embeds: [card],
      allowedMentions: { users: [member.id], roles: [] },
    })
    .catch((err) => console.error('[welcome] Failed to post the welcome card:', (err instanceof Error ? err.message : String(err))));
}

// Arrivals card used instead of the normal welcome when a rejoining member still has
// an active mute/ban that had to be re-applied, so the channel shows enforcement
// instead of a friendly welcome.
export function buildPunishmentArrivalCard(member: GuildMember, caseRow: CaseRecord) {
  const meta = TYPE_META[caseRow.type as keyof typeof TYPE_META] ?? TYPE_META.note;
  const lines = [
    `<@${member.id}> rejoined while Case #${caseRow.case_number} (${meta.label}) was still active.`,
    `The **${caseRow.type}** punishment was applied again automatically.`,
  ];
  if (caseRow.reason) lines.push('', `**Reason:** ${truncate(caseRow.reason, 300)}`);
  if (caseRow.expires_at) {
    lines.push(`**Expires:** ${ts(caseRow.expires_at, 'F')} (${rel(caseRow.expires_at)})`);
  }

  return baseEmbed(meta.color)
    .setTitle(caseRow.type === 'ban' ? 'Ban Re-applied' : 'Mute Re-applied')
    .setDescription(lines.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `${member.guild.name} • Automatic punishment enforcement`,
      iconURL: member.guild.iconURL({ size: 64 }) ?? undefined,
    })
    .setTimestamp(Date.now());
}

export async function sendPunishmentArrival(member: GuildMember, caseRow: CaseRecord) {
  const channelId = config.welcome?.channelId;
  if (!channelId || member.user.bot) return null;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) return null;

  return channel
    .send({
      content: `<@${member.id}> rejoined with an active punishment case.`,
      embeds: [buildPunishmentArrivalCard(member, caseRow)],
      allowedMentions: { users: [member.id], roles: [] },
    })
    .catch((err) => {
      console.error('[welcome] Failed to post the punishment arrival card:', (err instanceof Error ? err.message : String(err)));
      return null;
    });
}
