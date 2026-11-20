# Community & Member Services

Member profiles, invites, self roles, welcome, boost and voice features.

**Commands:** /invites, /info, /addselfrole, /removeselfrole.

**Services:** inviteHistory, inviteTracker, memberProfile, selfroles, welcome, boosts, boostFormat, createvoice, serverstats.

**Gateway events:** guildMemberAdd, guildMemberRemove, inviteCreate, inviteDelete, voiceStateUpdate.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
