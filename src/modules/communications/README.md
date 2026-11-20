# Messaging & Announcements

Token scoped message editing, publishing and previews.

**Commands:** /dictate.

**Services:** dictate, dictateWeb, notices.

**Gateway events:** interactionCreate.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
