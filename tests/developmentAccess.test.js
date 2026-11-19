import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  isDevelopmentAccessRole,
  canManageDevelopmentAccess,
  developmentAccessPermissionError
} from '../src/services/developmentAccess.js';
import { manageableRoleError } from '../src/services/roleOperations.js';
import { addSelfRoleEntry } from '../src/services/selfroles.js';
import { getRoleBranches, normalizeMemberRoles } from '../src/services/roleBranchPolicy.js';

const ownerId = '123456789012345672';
const otherId = '123456789012345673';
const managerId = config.roleBranches.manager;
const role = {
  id: config.developmentAccessRoleId || '123456789012345675',
  name: 'Development Access',
  position: 2,
  managed: false
};

function request({ actorId = otherId, roles = [] } = {}) {
  return {
    user: { id: actorId },
    member: {
      roles: {
        cache: new Map(roles.map(id => [id, { id }])),
        highest: { position: 20 }
      }
    },
    guild: {
      id: config.guildId,
      ownerId,
      roles: { everyone: { id: config.guildId } },
      members: {
        me: { permissions: { has: () => true }, roles: { highest: { position: 24 } } }
      }
    }
  };
}

test('Development Access is a separate functional role, not a Staff or Development rank', () => {
  const policy = getRoleBranches();
  assert.equal(policy.staff.includes(role.id), false);
  assert.equal(policy.development.includes(role.id), false);
  assert.equal(policy.specialties.includes(role.id), false);
  const original = new Set([role.id, config.verifiedRoleId]);
  const result = normalizeMemberRoles(original);
  assert.equal(result.changed, false);
  assert.deepEqual(result.roles, original);
  assert.equal(isDevelopmentAccessRole(role), true);
  assert.equal(isDevelopmentAccessRole({ id: role.id, name: 'Renamed' }), Boolean(config.developmentAccessRoleId));
  assert.equal(isDevelopmentAccessRole({ id: '123456789012345679', name: 'Backend Developer' }), false);
});

test('Only Founder and Manager can grant or revoke the restricted access role through bot commands', () => {
  const outsider = request();
  const moderator = request({ roles: [config.roleBranches.staff[3]] });
  const developer = request({ roles: [config.roleBranches.developer] });
  const manager = request({ roles: [managerId] });
  const founder = request({ actorId: ownerId });
  for (const interaction of [outsider, moderator, developer]) {
    assert.equal(canManageDevelopmentAccess(interaction), false);
    assert.match(developmentAccessPermissionError(interaction, role), /Only Founder or Manager/);
    assert.match(manageableRoleError(interaction, role), /Only Founder or Manager/);
  }
  for (const interaction of [manager, founder]) {
    assert.equal(canManageDevelopmentAccess(interaction), true);
    assert.equal(developmentAccessPermissionError(interaction, role), null);
    assert.equal(manageableRoleError(interaction, role), null);
  }
  assert.equal(developmentAccessPermissionError(outsider, { ...role, name: 'Beta Tester', id: '123456789012345679' }), null);
});

test('restricted role cannot be published on self-role panel or self-assigned', () => {
  const result = addSelfRoleEntry(role);
  assert.match(result.error, /cannot be self-assigned/);
});
