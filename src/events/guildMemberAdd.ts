import type { Client, ClientEvents } from 'discord.js';
import { registerAuthorityMemberJoin } from '../services/roleIntegrity.js';
import { withAuthorizedRoleMutation } from '../services/roleIntegrity.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import type { CaseRecord } from '../db.js';
import { COLORS } from '../constants.js';
import { getActiveCases, setCaseStatus } from '../db.js';
import { ensureMuteRole } from '../services/mutes.js';
import { sendModLog } from '../services/log.js';
import { sendPunishmentDm } from '../services/notify.js';
import { isVerifyEnabled, sendVerifyNotification } from '../services/verify.js';
import { sendPunishmentArrival, sendWelcome } from '../services/welcome.js';
import { buildAuditEmbed } from '../utils/embeds.js';
import { inviteTracker } from '../services/inviteTracker.js';

export const name = Events.GuildMemberAdd;

// Temporary cases whose duration ran out while the member was away are expired on
// the spot, so a rejoin never re-applies a punishment that is already over (the
// scheduler does the same from its boot restore; this covers the gap in between).
function liveCases(cases: CaseRecord[]): CaseRecord[] {
  const now = Date.now();
  return cases.filter((c) => {
    if (!c.expires_at || c.expires_at > now) return true;
    setCaseStatus(c.id, 'expired');
    return false;
  });
}

// Bots get the Bots role on join. Humans get the Member role from the Verify button
// in the verify channel; without verification configured it is still auto-assigned.
export async function execute(member: ClientEvents['guildMemberAdd'][0], client: Client) {
  if (member.guild.id !== config.guildId) return;
  registerAuthorityMemberJoin(member);

  // Bots role for bot accounts; bot accounts are never welcomed or punished.
  if (member.user.bot) {
    if (config.botsRoleId) {
      await withAuthorizedRoleMutation(member, { action: 'add', roles: config.botsRoleId, reason: 'Bots role on join' })
        .catch((err) => console.error('[guildMemberAdd] Failed to add the bots role:', err.message));
    }
    return;
  }


  await inviteTracker.onJoin(member).catch(error => console.error('[invites] Join tracking failed:', error.message));

  // Decide whether a punishment has to be re-applied before posting anything, so the
  // arrivals channel gets the enforcement card instead of the normal welcome card.
  const activeBans = liveCases(getActiveCases(member.guild.id, member.id, 'ban'));
  const activeMutes = activeBans.length
    ? []
    : liveCases(getActiveCases(member.guild.id, member.id, 'mute'));

  // Ban: the person can only rejoin after an out-of-band unban (which never touched
  // the case), so enforce the active ban again.
  if (activeBans.length) {
    const caseRow = activeBans[0];
    // DM first: once banned, the bot may no longer share a guild with the user and
    // therefore can no longer open a DM channel with them.
    await sendPunishmentDm(member, {
      guild: member.guild,
      caseRow,
      clientId: client.user?.id ?? '',
      reapplied: true,
    });

    try {
      await member.guild.members.ban(member.id, {
        reason: `Re-apply ban - Case #${caseRow.case_number}`,
      });
    } catch (err) {
      console.error('[guildMemberAdd] Failed to re-apply the ban:', err);
      // The ban could not be enforced - fall back to a normal rejoin.
      await sendWelcome(member);
      await sendVerifyNotification(member);
      return;
    }

    await sendPunishmentArrival(member, caseRow);
    await sendModLog(
      member.guild,
      buildAuditEmbed({
        title: 'Ban Re-applied',
        description: `<@${member.id}> rejoined while a ban case was active (Case #${caseRow.case_number}). They have been banned again.`,
        color: COLORS.ban,
      }),
    );
    return;
  }

  // Mute: hand the mute role back to the rejoiner.
  if (activeMutes.length) {
    const caseRow = activeMutes[0];
    try {
      const role = await ensureMuteRole(member.guild, { reason: 'Re-apply mute on rejoin' });
      if (!role) throw new Error('Muted role unavailable');
      await withAuthorizedRoleMutation(member, { action: 'add', roles: role, reason: `Re-apply mute - Case #${caseRow.case_number}` });
    } catch (err) {
      console.error('[guildMemberAdd] Failed to re-apply the mute:', err);
      // The mute could not be enforced - fall back to a normal rejoin.
      await sendWelcome(member);
      await sendVerifyNotification(member);
      return;
    }

    await sendPunishmentArrival(member, caseRow);
    await sendPunishmentDm(member, {
      guild: member.guild,
      caseRow,
      clientId: client.user?.id ?? '',
      reapplied: true,
    });
    await sendModLog(
      member.guild,
      buildAuditEmbed({
        title: 'Mute Re-applied',
        description: `<@${member.id}> rejoined while a mute case was active (Case #${caseRow.case_number}). The mute has been applied again.`,
        color: COLORS.mute,
      }),
    );
    await sendVerifyNotification(member);
    return;
  }

  // Normal rejoin: welcome card, then the verification notice.
  await sendWelcome(member);
  await sendVerifyNotification(member);
}
