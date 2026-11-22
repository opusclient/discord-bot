# Architecture

Opus System is a modular Discord bot implemented in strict TypeScript and compiled to Node.js ESM. It uses `discord.js`, SQLite and one Gateway process. Opus Manager independently controls the static Discord guild layout.

## Canonical source layout

| Directory | Role |
| --- | --- |
| `src/commands/*.ts` | Slash-command adapters |
| `src/events/*.ts` | Gateway event handlers |
| `src/services/*.ts` | Moderation, OAI, tickets, verification, logs and integrations |
| `src/ticket-actions/*.ts` | Ticket workflows |
| `src/utils/*.ts` | Typed helper functions and loaders |
| `src/index.ts` | Authorized runtime entrypoint |
| `src/deploy-commands.ts` | Authorized guild command registration |
| `src/config.ts` and `src/db.ts` | Configuration and persistence |
| `web/dictate/*.ts` | Browser editor source |
| `legacy/src/` and `legacy/web/` | Archived JavaScript for parity and rollback |
| `dist/` and `dist-web/` | Generated untracked output |

Only `src/` and `web/dictate/*.ts` are maintained source. The build compiles the backend to `dist/` and browser code to `dist-web/`, then copies compiled editor scripts into the served web directory. Do not edit generated JavaScript.

## Startup

The production service invokes `dist/index.js`, which requires `OPUS_TS_CUTOVER=1`. It loads compiled commands and event handlers, opens the configured SQLite database, then starts authorized services. OAI monitors entrusted role state and preserves Founder/Manager decisions. Historical OAI incidents are not reconstructed during a source migration.

Offline verification does not run a Discord client. `npm run verify` compiles both targets, checks strict TypeScript, validates 27 command/21 event registrations, confirms activation guards, and runs regression tests against JavaScript legacy and TypeScript outputs with isolated synthetic state.

## Service boundaries

Commands are adapters; business authorization belongs in services. OAI checks policy and history independently of native Discord permissions. Management controls Staff/Development eligibility and approvals. The separate Opus Manager owns static guild roles and channels when `serverManagedByOpusManager` is enabled. Ticket and moderation workflows must not bypass authority protections.

`npm run deploy` changes the Discord guild slash-command registry when explicitly authorized and is not infrastructure deployment. A live bot restart is never part of routine source verification.

See [Modules](MODULES.md) and [Operations](OPERATIONS.md).
