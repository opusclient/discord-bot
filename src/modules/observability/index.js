export const id = "observability";
export const title = "Audit & Observability";
export const purpose = "Audit stream, logs, integrity, metrics and records";
export const commands = Object.freeze([]);
export const services = Object.freeze(["auditlog", "guildAuditEvents", "log", "logIntegrity", "logIntegrityStore", "deletedMediaCache", "status"]);
export const events = Object.freeze(["messageDelete", "messageDeleteBulk", "messageUpdate", "guildAuditLogEntryCreate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
