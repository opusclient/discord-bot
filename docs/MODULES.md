# Feature ownership

Opus System is a single-process modular monolith. These areas identify business ownership, not individually deployed bots or a separate legacy command registry.

| Domain | Core TypeScript services | Commands |
| --- | --- | --- |
| OAI | `authorityDecisions.ts`, `roleIntegrity.ts` | Review interactions |
| Management | `roleBranchPolicy.ts`, `roleBranchService.ts`, `teamManagement.ts`, `roleOperations.ts` | /role, /promote, /demote |
| Moderation | `mutes.ts`, `scheduler.ts`, `escalation.ts`, `purge.ts` | /warning, /mute, /unmute, /kick, /ban, /unban, /blacklist, /purge, /punishments |
| Verification | `verify.ts`, `accountRoles.ts`, `accountLinkWebhook.ts` | /verify |
| Tickets | `tickets.ts`, `src/ticket-actions/` | /ticket, /claim, /unclaim |
| Community | `memberProfile.ts`, `inviteTracker.ts`, `selfroles.ts`, `createvoice.ts` | /info, /invites, /addselfrole, /removeselfrole |
| Customization | `customRoles.ts` | /customrole |
| Communications | `dictate.ts`, `dictateWeb.ts`, `web/dictate/` | /dictate |
| Auditing | `auditlog.ts`, `guildAuditEvents.ts`, `logIntegrity.ts`, `logIntegrityStore.ts` | Gateway events |
| Integrations | `overlayBridge.ts` and `accountLinkWebhook.ts` | Optional bridges |
| Operations | `install.ts`, `restart.ts`, `slashSync.ts` | /help, /install, /setup, /uninstall, /restart |

All **27 slash commands** are loaded from the compiled `dist/commands/` directory. Commands must have unique names and valid execution functions. Gateway events are loaded separately from `dist/events/`.

## Conventions

1. Command handlers validate interaction inputs and call domain services; they do not duplicate business policy.
2. OAI and Management remain distinct. Founder review can override Manager decisions.
3. Evidence logs are retained independently of ordinary moderation permissions.
4. Shared config and database modules are not authorization shortcuts.
5. `legacy/` is a read-only rollback reference. Never import it from maintained source.
6. Compile strict TypeScript, validate command/event parity and pass the synthetic regression suite before any commit or production change.

See [Architecture](ARCHITECTURE.md) and [TypeScript migration](TYPESCRIPT_MIGRATION.md).
