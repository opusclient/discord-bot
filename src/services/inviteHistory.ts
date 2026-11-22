import { db } from '../db.js';
export type InviteJoinInput = {
  guildId: string;
  userId: string;
  inviterId?: string | null;
  inviteCode?: string | null;
  at?: number;
};

export type InviteHistoryRow = {
  guild_id: string;
  user_id: string;
  inviter_id: string | null;
  invite_code: string | null;
  source: 'invite' | 'unknown';
  joined_at: number;
  last_join_at: number;
  left_at: number | null;
};



db.exec("CREATE TABLE IF NOT EXISTS invite_tracking_meta (guild_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS invite_join_history (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, inviter_id TEXT, invite_code TEXT, source TEXT NOT NULL CHECK(source IN ('invite','unknown')), joined_at INTEGER NOT NULL, last_join_at INTEGER NOT NULL, left_at INTEGER, PRIMARY KEY(guild_id,user_id))");
db.exec("CREATE INDEX IF NOT EXISTS idx_invite_join_inviter ON invite_join_history(guild_id,inviter_id,left_at)");

const setStart = db.prepare("INSERT OR IGNORE INTO invite_tracking_meta(guild_id,started_at) VALUES (?,?)");
const start = db.prepare("SELECT started_at FROM invite_tracking_meta WHERE guild_id = ?");
const insert = db.prepare("INSERT INTO invite_join_history(guild_id,user_id,inviter_id,invite_code,source,joined_at,last_join_at,left_at) VALUES (?,?,?,?,?,?,?,NULL) ON CONFLICT(guild_id,user_id) DO UPDATE SET last_join_at=excluded.last_join_at,left_at=NULL");
const leave = db.prepare("UPDATE invite_join_history SET left_at=? WHERE guild_id=? AND user_id=?");
const summary = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN left_at IS NULL THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END) AS left_count FROM invite_join_history WHERE guild_id=? AND inviter_id=? AND source='invite'");
const recent = db.prepare("SELECT user_id,joined_at,left_at FROM invite_join_history WHERE guild_id=? AND inviter_id=? AND source='invite' ORDER BY joined_at DESC LIMIT ?");

export function beginInviteTracking(guildId: string, at: number = Date.now()): number {
  setStart.run(guildId, at);
  return Number(start.get(guildId)?.started_at ?? at);
}

export function getInviteTrackingSince(guildId: string): number | null {
  const value = start.get(guildId)?.started_at;
  return value == null ? null : Number(value);
}

export function recordInviteJoin({ guildId, userId, inviterId = null, inviteCode = null, at = Date.now() }: InviteJoinInput): InviteHistoryRow | null {
  const attributed = Boolean(inviterId && inviterId !== userId);
  insert.run(guildId, userId, attributed ? inviterId : null, attributed ? inviteCode : null,
    attributed ? 'invite' : 'unknown', at, at);
  return (db.prepare("SELECT * FROM invite_join_history WHERE guild_id=? AND user_id=?").get(guildId, userId) as unknown as InviteHistoryRow | undefined) ?? null;
}

export function recordInviteLeave(guildId: string, userId: string, at: number = Date.now()): boolean {
  return leave.run(at, guildId, userId).changes > 0;
}

export function getInviteStats(guildId: string, userId: string, limit: number = 5) {
  const row = summary.get(guildId, userId);
  return {
    total: Number(row?.total ?? 0),
    present: Number(row?.present ?? 0),
    left: Number(row?.left_count ?? 0),
    since: getInviteTrackingSince(guildId),
    recent: recent.all(guildId, userId, Math.min(10, Math.max(1, Number(limit) || 5)))
  };
}
