# Operations and deployment

## Recommended workflow

```bash
npm ci
npm test
npm run deploy -- --check
npm run deploy
npm start
```

Run `npm test` before changing live configuration. The tests use only synthetic Discord IDs and an isolated configuration fixture. Register commands only after verifying `.env`, `CLIENT_ID` and the target `guildId`.

In production, run the bot under a supervisor such as systemd, a service manager or a dedicated container orchestration unit. Never commit host-specific service units containing credentials or private SSH paths to this repository.

## Configuration and state

| Data | Location | Commit? |
| --- | --- | --- |
| Sample guild settings | `config.example.json` | Yes |
| Synthetic test config | `tests/fixtures/config.test.json` | Yes |
| Real guild configuration | `config.json` | **No** |
| Bot token and webhook secret | `.env` / secret manager | **No** |
| Ticket, case and invite tracking DB | `data/*.sqlite` and WAL files | **No** |
| Ticket transcripts, logs and backups | Runtime disk | **No** |
| Code and unit tests | `src/`, `tests/` | Yes |

## Backups

1. Stop the bot or use a consistent SQLite backup mechanism; do not blindly copy a changing WAL-mode database.
2. Back up `config.json`, the SQLite database and private transcript storage separately.
3. Store archives encrypted and restrict their access.
4. Before upgrades, document the service version and ensure backups restore on a nonproduction instance.
5. Keep token values out of support tickets and public logs.

## Deployments

- `npm run deploy -- --check` only audits the command registry.
- `npm run deploy` updates **guild-scoped** slash commands and verifies the new registry; this is a real Discord mutation.
- On startup, the bot checks and synchronizes only if the registry differs.
- Features and listeners require the appropriate Discord Gateway intents.
- The bot requires sufficient role hierarchy and API privileges for role operations.

**Caution:** If this is not the original Opus Client guild, configure all IDs for your own server. The public code does not contain the original production IDs or infrastructure deployment scripts.

## What to inspect after an upgrade

- Startup log shows successful login and guild command registration.
- `/help` and `/info` respond for authorized users.
- The Support Center panel has nine categories, a working select/modal and private action responses.
- Role reconciliation preserves Staff/Development independence and the Discord Developer exception.
- The bot can write to configured moderation, audit, AutoMod, blacklist and ticket logs.
- Invite tracking creates a snapshot; unambiguous new joins count correctly.
- Ticket closures produce transcripts and do not lose open tickets if upload fails.

## Troubleshooting

| Symptom | Common cause |
| --- | --- |
| Slash commands missing | Wrong application/guild ID, missing OAuth scope, stale command registry |
| Bot cannot change a role | Bot role too low, denied Manage Roles, protected target or policy rejection |
| Manager cannot self-assign Development Access | Correct behavior: Manager already has Development rights |
| Discord Developer gains Staff roles briefly then loses them | Reconciler enforces incompatibility |
| Ticket user remains after removing a role | Another role grants access; use direct user removal if appropriate |
| Invite total is lower than link usage count | Only unambiguous tracked member joins count; old uses and unknown joins are excluded |
| Ticket panel doesn't refresh | Channel/message ID wrong or missing channel permissions |
| Message contents absent from audit | Discord Gateway/cache cannot always recover edited/deleted messages |
| Some log channels are silent | Channel IDs or send permissions missing, or no corresponding event yet |

## Release safety

Before publishing a public release, inspect the entire **Git history**, not only the current working tree, for accidentally committed secrets or private data. Rotate any exposed tokens; deleting a secret from the latest commit alone is not sufficient.
