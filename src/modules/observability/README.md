# Audit & Observability

Audit stream, logs, integrity, metrics and records.

**Commands:** None.

**Services:** auditlog, guildAuditEvents, log, logIntegrity, logIntegrityStore, deletedMediaCache, status.

**Gateway events:** messageDelete, messageDeleteBulk, messageUpdate, guildAuditLogEntryCreate.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
