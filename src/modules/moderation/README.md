# Moderation & Enforcement

Punishment lifecycle, moderation actions and escalations.

**Commands:** /warning, /mute, /unmute, /kick, /ban, /unban, /blacklist, /purge, /punishments.

**Services:** mutes, escalation, purge, scheduler, historyCommand.

**Gateway events:** autoModerationActionExecution, guildMemberAdd.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
