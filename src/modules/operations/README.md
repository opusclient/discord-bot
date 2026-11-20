# Bot Operations

Setup, runtime control, command registration and server checks.

**Commands:** /help, /install, /setup, /uninstall, /restart.

**Services:** install, restart, slashSync, helpPanel.

**Gateway events:** clientReady, interactionCreate.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
