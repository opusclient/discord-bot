import { config } from '../config.js';
import type { Guild, GuildMember, Collection } from 'discord.js';

type NicknameState = { base_nickname: string | null; last_applied: string };

import { db } from '../db.js';
import { calculateRoleNickname, roleNicknamePrefix, stripRolePrefix } from './nicknamePolicy.js';

db.exec(`
CREATE TABLE IF NOT EXISTS managed_staff_nicknames (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  base_nickname TEXT,
  last_applied TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`);

const getState = db.prepare('SELECT base_nickname, last_applied FROM managed_staff_nicknames WHERE guild_id = ? AND user_id = ?');
const putState = db.prepare(`INSERT INTO managed_staff_nicknames
  (guild_id, user_id, base_nickname, last_applied, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    base_nickname=excluded.base_nickname,
    last_applied=excluded.last_applied,
    updated_at=excluded.updated_at`);
const deleteState = db.prepare('DELETE FROM managed_staff_nicknames WHERE guild_id = ? AND user_id = ?');

const pending = new Map<string, ReturnType<typeof reconcileOne>>();

async function reconcileOne(member: GuildMember) {
  if (!config.nicknames?.enabled || !member || member.user?.bot || member.guild?.id !== config.guildId) {
    return { status: 'ignored' };
  }

  const saved = (getState.get(member.guild.id, member.id) as unknown as NicknameState | undefined) ?? null;
  const prefix = roleNicknamePrefix(member, config.nicknames);
  const existing = member.nickname ?? null;

  if (!prefix) {
    if (!saved) return { status: 'unchanged' };
    if (existing !== saved.last_applied) {
      deleteState.run(member.guild.id, member.id);
      return { status: 'released', reason: 'nickname-customized' };
    }
    if (member.id === member.guild.ownerId || member.manageable === false) {
      return { status: 'blocked', reason: member.id === member.guild.ownerId ? 'guild-owner' : 'role-hierarchy' };
    }
    await member.setNickname(saved.base_nickname, 'Restore nickname after removing Opus team role');
    deleteState.run(member.guild.id, member.id);
    return { status: 'restored', nickname: saved.base_nickname };
  }

  let base = saved?.base_nickname ?? null;
  if (!saved || existing !== saved.last_applied) {
    base = existing === null ? null : stripRolePrefix(existing);
    if (base === '') base = null;
  }

  const target = calculateRoleNickname(member, config.nicknames, base);
  if (!target) return { status: 'ignored', reason: 'empty-base' };
  if (member.id === member.guild.ownerId || member.manageable === false) {
    return { status: 'blocked', reason: member.id === member.guild.ownerId ? 'guild-owner' : 'role-hierarchy', desired: target };
  }

  if (existing !== target) {
    await member.setNickname(target, 'Apply Opus team role prefix');
  }
  putState.run(member.guild.id, member.id, base, target, Date.now());
  return { status: existing === target ? 'unchanged' : 'updated', nickname: target };
}

export async function syncStaffNickname(member: GuildMember) {
  if (!member?.id) return { status: 'ignored' };
  const key = `${member.guild?.id}:${member.id}`;
  const earlier = pending.get(key) ?? Promise.resolve();
  const current = earlier.catch(() => {}).then(() => reconcileOne(member));
  pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}

export async function reconcileStaffNicknames(guild: Guild) {
  const result = { scanned: 0, updated: 0, restored: 0, unchanged: 0, blocked: 0, failed: 0 };
  if (!config.nicknames?.enabled || guild.id !== config.guildId) return result;
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const members: Collection<string, GuildMember> = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
    if (!members.size) break;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      result.scanned++;
      if (!roleNicknamePrefix(member, config.nicknames) &&
          !getState.get(guild.id, member.id)) {
        continue;
      }
      try {
        const state = await syncStaffNickname(member);
        if (Object.hasOwn(result, state.status)) result[state.status as keyof typeof result]++;
      } catch (error) {
        result.failed++;
        console.error('[staff-nicknames] Failed to sync member', member.id, (error instanceof Error ? error.message : String(error)));
      }
    }
    if (members.size < 1000) break;
    after = [...members.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1).at(-1);
  }
  return result;
}
