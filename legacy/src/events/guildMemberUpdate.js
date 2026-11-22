import { evaluateMemberRoleUpdate } from '../services/roleIntegrity.js';
import { Events } from 'discord.js';
import { syncStaffNickname } from '../services/staffNicknames.js';
import { reconcileRoleBranches } from '../services/roleBranchService.js';

export const name = Events.GuildMemberUpdate;

export async function execute(previous, member) {
  const before = [...previous.roles.cache.keys()].sort().join(',');
  const after = [...member.roles.cache.keys()].sort().join(',');
  if (before === after && previous.nickname === member.nickname) return;
  if (before !== after) {
    await evaluateMemberRoleUpdate(previous, member).catch(error =>
      console.error('[OAI] Member update failed:', member.id, error.message)
    );
    await reconcileRoleBranches(member).catch(error =>
      console.error('[role-branch] Member update failed:', member.id, error.message)
    );
  }
  await syncStaffNickname(member).catch(error =>
    console.error('[staff-nicknames] Member update failed:', error.message)
  );
}
