// Automatic mute escalation when a member reaches the configured warning threshold.
import { config } from '../config.js';
import type { Guild, Client } from 'discord.js';
import { countActiveByType, getActiveCases } from '../db.js';
import { parseDuration } from '../utils/duration.js';
import { applyMute } from './mutes.js';

// Returns { caseRow, threshold } when an automatic mute was applied, otherwise null.
export async function applyWarnEscalation(guild: Guild, userId: string, client: Client) {
  const { threshold, duration } = config.warnEscalation ?? {};
  if (!threshold || threshold <= 0) return null;

  const activeWarns = countActiveByType(guild.id, userId, 'warn');
  if (activeWarns < threshold) return null;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  if (getActiveCases(guild.id, userId, 'mute').length) return null;

  let durationMs = null;
  try {
    durationMs = parseDuration(duration);
  } catch {
    durationMs = 3_600_000; // fall back to 1 hour on invalid config
  }

  const { caseRow } = await applyMute(guild, member, {
    moderatorId: client.user?.id ?? 'system',
    reason: `Automatic mute: reached ${threshold} active warning(s)`,
    durationMs,
    clientId: client.user?.id ?? 'system',
  });
  return { caseRow, threshold };
}
