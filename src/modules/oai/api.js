export async function loadAuthorityDecisions() {
  return import('../../services/authorityDecisions.js');
}

export async function loadRoleIntegrity() {
  return import('../../services/roleIntegrity.js');
}
