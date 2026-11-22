import type { Client, ClientEvents } from 'discord.js';
import { evaluateMemberRoleUpdate } from '../services/roleIntegrity.js';
import { Events } from 'discord.js';
import { syncStaffNickname } from '../services/staffNicknames.js';
import { reconcileRoleBranches } from '../services/roleBranchService.js';

export const name = Events.GuildMemberUpdate;

export async function execute(previous: ClientEvents['guildMemberUpdate'][0], member: ClientEvents['guildMemberUpdate'][1]) {
  const before = [...previous.roles.cache.keys()].sort().join(',');
  const after = [...member.roles.cache.keys()].sort().join(',');
  if (before === after && previous.nickname === member.nickname) return;
  if (before !== after) {
    await evaluateMemberRoleUpdate(previous as import('discord.js').GuildMember, member).catch(error =>
      console.error('[OAI] Member update failed:', member.id, (error instanceof Error ? error.message : String(error)))
    );
    await reconcileRoleBranches(member).catch(error =>
      console.error('[role-branch] Member update failed:', member.id, (error instanceof Error ? error.message : String(error)))
    );
  }
  await syncStaffNickname(member).catch(error =>
    console.error('[staff-nicknames] Member update failed:', (error instanceof Error ? error.message : String(error)))
  );
}
