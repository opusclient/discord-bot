import { beginInviteTracking, recordInviteJoin, recordInviteLeave } from './inviteHistory.js';
import type { Guild, GuildMember, PartialGuildMember, Invite } from 'discord.js';

export type InviteSnapshotEntry = {
  code: string;
  inviterId: string | null;
  uses: number;
};

export type InviteSnapshot = Map<string, InviteSnapshotEntry>;

export function snapshotInvites(invites: { values(): IterableIterator<Invite> }): InviteSnapshot {
  const snapshot: InviteSnapshot = new Map();
  for (const invite of invites.values()) {
    if (!invite.code) continue;
    snapshot.set(invite.code, {
      code: invite.code,
      inviterId: invite.inviter?.id ?? invite.inviterId ?? null,
      uses: Number(invite.uses) || 0
    });
  }
  return snapshot;
}

export function identifyInviteUse(
  before: InviteSnapshot | null | undefined,
  after: InviteSnapshot
): { code: string; inviterId: string } | null {
  if (!before) return null;
  const increased: Array<{ code: string; inviterId: string | null; uses: number }> = [];
  for (const [code, next] of after) {
    const previous = before.get(code);
    if (!previous) continue;
    const difference = next.uses - previous.uses;
    if (difference > 0) increased.push({
      code,
      inviterId: next.inviterId ?? previous.inviterId,
      uses: difference
    });
  }
  if (increased.length !== 1 || increased[0].uses !== 1 || !increased[0].inviterId) return null;
  return { code: increased[0].code, inviterId: increased[0].inviterId };
}

export class InviteTracker {
  readonly snapshots: Map<string, InviteSnapshot>;
  readonly queues: Map<string, Promise<unknown>>;
  readonly begin: typeof beginInviteTracking;
  readonly join: typeof recordInviteJoin;
  readonly leave: typeof recordInviteLeave;

  constructor({
    begin = beginInviteTracking,
    join = recordInviteJoin,
    leave = recordInviteLeave
  }: {
    begin?: typeof beginInviteTracking;
    join?: typeof recordInviteJoin;
    leave?: typeof recordInviteLeave;
  } = {}) {
    this.snapshots = new Map();
    this.queues = new Map();
    this.begin = begin;
    this.join = join;
    this.leave = leave;
  }

  async initialize(guild: Guild): Promise<number> {
    const invites = await guild.invites.fetch();
    this.snapshots.set(guild.id, snapshotInvites(invites));
    this.begin(guild.id);
    return invites.size;
  }

  onCreate(invite: Invite): void {
    const cache = invite.guild?.id ? this.snapshots.get(invite.guild.id) : null;
    if (!cache || !invite.code) return;
    cache.set(invite.code, {
      code: invite.code,
      inviterId: invite.inviter?.id ?? null,
      uses: Number(invite.uses) || 0
    });
  }

  onDelete(invite: Invite): void {
    const cache = invite.guild?.id ? this.snapshots.get(invite.guild.id) : null;
    if (cache) cache.delete(invite.code);
  }

  async onJoin(member: GuildMember) {
    if (member.user.bot) return null;
    const guildId = member.guild.id;
    const previous = this.queues.get(guildId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      let attribution: { code: string; inviterId: string } | null = null;
      try {
        const latest = snapshotInvites(await member.guild.invites.fetch());
        attribution = identifyInviteUse(this.snapshots.get(guildId), latest);
        this.snapshots.set(guildId, latest);
        this.begin(guildId);
      } catch (error) {
        this.snapshots.delete(guildId);
        console.error('[invites] Could not fetch invite usage for member join:',
          error instanceof Error ? error.message : String(error));
      }
      return this.join({
        guildId,
        userId: member.id,
        inviterId: attribution?.inviterId ?? null,
        inviteCode: attribution?.code ?? null
      });
    });
    this.queues.set(guildId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(guildId) === current) this.queues.delete(guildId);
    }
  }

  onLeave(member: GuildMember | PartialGuildMember): boolean {
    if (member.user.bot) return false;
    return this.leave(member.guild.id, member.id);
  }
}

export const inviteTracker = new InviteTracker();
