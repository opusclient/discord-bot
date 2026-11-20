# Verification & Onboarding

Member verification, role onboarding and private account validation.

**Commands:** /verify.

**Services:** verify, accountLinkWebhook.

**Gateway events:** guildMemberAdd, interactionCreate.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
