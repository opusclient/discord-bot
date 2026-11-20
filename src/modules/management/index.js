export const id = "management";
export const title = "Team & Role Management";
export const purpose = "Staff and Development branches, promotion, delegation, account roles and member positions";
export const commands = Object.freeze(["role", "promote", "demote"]);
export const services = Object.freeze(["roleBranchPolicy", "roleBranchService", "roleOperations", "teamManagement", "teamRoleHistory", "staffNicknames", "nicknamePolicy", "developmentAccess", "accountRoles"]);
export const events = Object.freeze(["guildMemberUpdate", "clientReady"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
