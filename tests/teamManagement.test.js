import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  isTeamManagementRole,
  isManagerPlus,
  canManageBranch,
  roleOperationScope,
  teamManagementPermissionError,
  isEligibleForManagementRole,
  managementEligibilityError
} from '../src/services/teamManagement.js';
import { normalizeMemberRoles, planRoleChange } from '../src/services/roleBranchPolicy.js';
import { targetRoleError } from '../src/services/roleOperations.js';
import { addSelfRoleEntry } from '../src/services/selfroles.js';

const policy = config.roleBranches;
const staffRole = { id: policy.staff[3], name: 'Moderator', position: 12 };
const developerRole = { id: policy.developer, name: 'Developer', position: 18 };
const staffManagement = { id: config.staffManagementRoleId, name: 'Staff Management', position: 9, managed: false };
const devManagement = { id: config.developmentManagementRoleId, name: 'Development Management', position: 10, managed: false };
const actorId = '123456789012345610';
const ownerId = '123456789012345611';
const botId = '123456789012345612';

function mock(roleIds = [], asOwner = false) {
  return {
    guildId: config.guildId,
    user: { id: asOwner ? ownerId : actorId },
    guild: {
      id: config.guildId,
      ownerId,
      members: {
        me: { id: botId, roles: { highest: { position: 22 } } }
      }
    },
    member: {
      roles: {
        cache: new Map(roleIds.map(id => [id, { id }])),
        highest: { position: 19 }
      }
    }
  };
}

test('only the owner, Manager or Staff Management may manage the Staff branch', () => {
  assert.equal(canManageBranch(mock([], true), 'staff'), true);
  assert.equal(canManageBranch(mock([policy.manager]), 'staff'), true);
  assert.equal(canManageBranch(mock([staffManagement.id]), 'staff'), true);
  assert.equal(canManageBranch(mock([policy.staff[2]]), 'staff'), false);
  assert.equal(canManageBranch(mock([devManagement.id]), 'staff'), false);
  assert.equal(canManageBranch(mock([policy.principal]), 'staff'), false);
  assert.equal(canManageBranch(mock([policy.developer]), 'staff'), false);
});

test('Principal Engineer automatically manages Development without the delegation role', () => {
  assert.equal(canManageBranch(mock([], true), 'development'), true);
  assert.equal(canManageBranch(mock([policy.principal]), 'development'), true);
  assert.equal(canManageBranch(mock([devManagement.id]), 'development'), true);
  assert.equal(canManageBranch(mock([policy.specialties[2]]), 'development'), false);
  assert.equal(canManageBranch(mock([policy.manager]), 'development'), false);
  assert.equal(canManageBranch(mock([staffManagement.id]), 'development'), false);
  assert.equal(canManageBranch(mock([policy.developer]), 'development'), false);
});

test('Management roles cannot be delegated through unrelated branches', () => {
  assert.equal(isTeamManagementRole(staffManagement), true);
  assert.equal(isTeamManagementRole(devManagement), true);
  assert.equal(roleOperationScope(staffRole, null), 'staff');
  assert.equal(roleOperationScope(null, developerRole), 'development');
  assert.equal(roleOperationScope(null, staffManagement), null);
  assert.match(teamManagementPermissionError(mock([staffManagement.id]), null, developerRole), /Development branch/);
  assert.match(teamManagementPermissionError(mock([devManagement.id]), null, staffRole), /Staff branch/);
  assert.equal(teamManagementPermissionError(mock([staffManagement.id]), null, staffRole), null);
  assert.equal(teamManagementPermissionError(mock([policy.principal]), null, developerRole), null);
  assert.match(teamManagementPermissionError(mock([policy.staff[2]]), null, devManagement), /Only Founder/);
  assert.match(teamManagementPermissionError(mock([policy.manager]), null, devManagement), /Only Founder/);
  assert.match(teamManagementPermissionError(mock([policy.manager]), devManagement, null), /Only Founder/);
  assert.match(teamManagementPermissionError(mock([policy.manager, devManagement.id]), devManagement, null), /Only Founder/);
  assert.equal(teamManagementPermissionError(mock([policy.manager]), null, staffManagement), null);
  assert.equal(teamManagementPermissionError(mock([policy.manager]), staffManagement, null), null);
  assert.equal(teamManagementPermissionError(mock([], true), null, staffManagement), null);
  assert.equal(teamManagementPermissionError(mock([], true), null, devManagement), null);
  assert.equal(teamManagementPermissionError(mock([], true), devManagement, null), null);
});

test('Staff Management requires Adminstrator or Development rank; Development Management requires Manager', () => {
  assert.equal(isEligibleForManagementRole(staffManagement.id, [policy.staff[2]]), true);
  assert.equal(isEligibleForManagementRole(staffManagement.id, [policy.developer]), true);
  assert.equal(isEligibleForManagementRole(staffManagement.id, [policy.principal]), true);
  assert.equal(isEligibleForManagementRole(staffManagement.id, [policy.staff[3]]), false);
  assert.equal(isEligibleForManagementRole(devManagement.id, [policy.manager]), true);
  assert.equal(isEligibleForManagementRole(devManagement.id, [policy.principal]), false);
  assert.match(managementEligibilityError(staffManagement, [policy.staff[3]]), /Adminstrator/);
  assert.match(managementEligibilityError(devManagement, [policy.principal]), /only to a Manager/);
  assert.throws(() => planRoleChange([policy.staff[3]], { mode: 'add', toId: staffManagement.id }), /requires Adminstrator/);
  assert.throws(() => planRoleChange([policy.principal], { mode: 'add', toId: devManagement.id }), /requires the Manager/);
  assert.equal(planRoleChange([policy.staff[2]], { mode: 'add', toId: staffManagement.id }).roles.has(staffManagement.id), true);
  assert.equal(planRoleChange([policy.manager], { mode: 'add', toId: devManagement.id }).roles.has(devManagement.id), true);
});

test('Manager cannot self-assign management delegation or change their own team rank', () => {
  const interaction = mock([policy.manager]);
  assert.equal(isManagerPlus(interaction), true);
  for (const role of [staffManagement, devManagement]) {
    assert.match(targetRoleError(interaction, { id: actorId, roles: { highest: { position: 20 } } }, {
      mode: 'add', toRole: role
    }), /management delegation/);
  }
  assert.match(targetRoleError(mock([policy.staff[2]]), {
    id: actorId, roles: { highest: { position: 13 } }
  }, { mode: 'add', toRole: staffManagement }), /Only Manager or Founder/);
});

test('Delegation expires when the qualifying team role is removed', () => {
  const admin = policy.staff[2];
  const moderator = policy.staff[3];
  const manager = policy.manager;
  assert.equal(normalizeMemberRoles([moderator, staffManagement.id]).roles.has(staffManagement.id), false);
  assert.equal(normalizeMemberRoles([policy.principal, devManagement.id]).roles.has(devManagement.id), false);
  const staff = planRoleChange([admin, staffManagement.id], {
    mode: 'demote', fromId: admin, toId: moderator
  });
  assert.equal(staff.roles.has(staffManagement.id), false);
  assert.equal(staff.roles.has(moderator), true);
  const development = planRoleChange([manager, devManagement.id], {
    mode: 'demote', fromId: manager, toId: moderator
  });
  assert.equal(development.roles.has(devManagement.id), false);
  assert.equal(development.roles.has(moderator), true);
});

test('Management delegation is never a public self-role', () => {
  assert.match(addSelfRoleEntry(staffManagement).error, /cannot be self-assigned/);
  assert.match(addSelfRoleEntry(devManagement).error, /cannot be self-assigned/);
});

test('Discord Developer cannot manage Development through native Administrator or its specialty', () => {
  const discordDeveloper = policy.specialties[2];
  const actor = mock([policy.developer, discordDeveloper]);
  actor.member.permissions = { has: () => true };
  assert.equal(canManageBranch(actor, 'development'), false);
  assert.match(teamManagementPermissionError(actor, null, developerRole), /Development branch management/);
  assert.equal(canManageBranch(mock([policy.principal]), 'development'), true);
  assert.equal(canManageBranch(mock([devManagement.id]), 'development'), true);
  assert.equal(canManageBranch(mock([], true), 'development'), true);
});

test('Management delegation is restricted by role type even with native Administrator', () => {
  const manager = mock([policy.manager]);
  manager.member.permissions = { has: () => true };
  const staffDelegate = mock([staffManagement.id]);
  staffDelegate.member.permissions = { has: () => true };
  for (const actor of [manager, staffDelegate, mock([policy.principal]), mock([policy.specialties[2]])]) {
    assert.match(teamManagementPermissionError(actor, null, devManagement), /Only Founder/);
    assert.match(teamManagementPermissionError(actor, devManagement, null), /Only Founder/);
  }
  assert.equal(teamManagementPermissionError(manager, null, staffManagement), null);
  assert.equal(teamManagementPermissionError(manager, staffManagement, null), null);
  assert.match(teamManagementPermissionError(staffDelegate, null, staffManagement), /Only Founder or Manager/);
  assert.equal(teamManagementPermissionError(mock([], true), null, devManagement), null);
});
