export const id = "oai";
export const title = "Opus Authority Integrity";
export const purpose = "Authoritative role history, audit drift detection, and controlled reconciliation";
export const commands = Object.freeze([]);
export const services = Object.freeze(["authorityDecisions", "roleIntegrity"]);
export const events = Object.freeze(["guildMemberUpdate", "guildAuditLogEntryCreate", "clientReady"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
