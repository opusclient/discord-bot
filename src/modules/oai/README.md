# Opus Authority Integrity

Authoritative role history, audit drift detection, and controlled reconciliation.

**Commands:** None.

**Services:** authorityDecisions, roleIntegrity.

**Gateway events:** guildMemberUpdate, guildAuditLogEntryCreate, clientReady.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.

The OAI API facade uses deferred imports because authorityDecisions and roleIntegrity are still uncommitted, actively developed services. Importing the facade is safe in a clean checkout, but invoking its loaders requires those services to be merged first.
