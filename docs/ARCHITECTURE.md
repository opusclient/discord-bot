# Architecture

Opus System is a **single Discord bot process** written with `discord.js` and JavaScript ES modules. It persists operational state in SQLite and consumes Discord Gateway events.

## Boundaries

```text
Discord Guild / Gateway
        │
        ▼
  src/index.js
        │
        ├── src/events/                 Event handlers
        ├── src/commands/               Slash commands
        │       │
        │       └── src/services/       Authorization and business logic
        │               │
        │               ▼
        │           src/db.js           SQLite
        │
        ├── src/ticket-actions/         Ticket-specific handlers
        └── src/deploy-commands.js      Guild command registry
```

The bot is deliberately **not the owner of the entire server layout**. When `serverManagedByOpusManager` is enabled, the separate **Opus Manager** application controls static roles, category order, default channel permissions and fixed channels. Opus System handles dynamic roles and interactions, temporary support and voice channels, status messages and moderation.

## Startup

1. Load `.env` and `config.json` through `src/config.js`.
2. Initialize the SQLite database in `src/db.js` and feature-specific tables.
3. Construct the Discord client with the required Gateway intents.
4. Register command handlers from `src/commands/` and event handlers from `src/events/`.
5. On `ClientReady`, initialize periodic work, check the guild slash command registry, reconcile team roles, prepare invite tracking and refresh applicable panels.

The event implementations are intentionally separate so a failed moderation notification should not silently invalidate the actual punishment or role operation.

## Data and responsibilities

| Component | Main responsibility |
| --- | --- |
| `src/config.js` | Local configuration loading, default values and controlled updates |
| `src/db.js` | SQLite schema and statements; cases, tickets, joins, states and records |
| `src/services/roleBranchPolicy.js` | Pure Staff/Development hierarchy and consistency rules |
| `src/services/teamManagement.js` | Independent Staff/Development delegation and implicit Principal Engineer permissions |
| `src/services/roleBranchService.js` | Serialized per-member role updates and reconciliation |
| `src/services/roleOperations.js` | Bulk role commands, authorization, notifications and history |
| `src/services/teamRoleHistory.js` | Structured promote/demote records |
| `src/services/tickets.js` | Ticket panels, lifecycle, overwrites and transcripts |
| `src/services/auditlog.js` | Member message edits/deletes routed to moderation, separate from guild configuration audit |
| `src/services/guildAuditEvents.js` | Audit event classification, formatting and routing |
| `src/services/inviteTracker.js` | Guild invite snapshots and join attribution |
| `src/services/inviteHistory.js` | Invite join/leave records and member statistics |
| `src/services/accountLinkWebhook.js` | Optional signed account-status callback |
| `src/services/overlayBridge.js` | Optional, separate integration bridge |
| `src/utils/permissions.js` | Discord and role-aware command authorization |
| `src/utils/visibility.js` | Public-by-default slash command responses |

## Role update pipeline

```text
/role, /promote, /demote
        │
        ▼
Permission and role hierarchy checks
        │
        ▼
RoleBranchPolicy.planRoleChange(...)
        │
        ▼
Per-member lock in RoleBranchService
        │
        ▼
Single member.roles.set(...) operation
        │
        ├── Verify updated member state
        ├── Save promote/demote history
        ├── Notify affected member via DM
        └── Emit moderation log
```

The policy runs **again** on manual role updates received through `GuildMemberUpdate` and during startup reconciliation. This keeps the team branches consistent even if a role is changed directly in Discord. The guild owner is exempt from automatic rank rewriting.

The policy operates using **configured role IDs**, not arbitrary role color, name or the role list's visual order. Discord role hierarchy is still checked independently before a bot-driven mutation.

## Ticket lifecycle

```text
Two-embed support panel
    ├── Category select → Purpose modal → Ticket created
    ├── My Tickets / Status / Guide buttons
    └── /ticket add, remove, rename, close
          /claim, /unclaim
             │
             ├── SQLite ticket record
             ├── Channel overwrites and staff visibility
             └── HTML transcript on close
```

Ticket channels are placed into configured ticket categories; the global ticket counter is stored in SQLite. Closing a ticket requires successful transcript generation/upload before channel deletion.

For the full access model and critical direct-user-deny behavior, see [TICKETS.md](TICKETS.md).

## Auditing and log routing

The bot uses **four active log destinations**, each with a single responsibility:

| Destination | Events |
| --- | --- |
| `audit-logs` | Guild/server changes: roles, channels, permission overwrites, integrations, invites, webhooks and configuration |
| `moderation-logs` | Staff-issued cases, manual moderation, blacklists, purges, member message edits/deletions and bulk deletions |
| `automod-logs` | Discord AutoMod Gateway actions, bot-initiated enforcement, automated mutes and scheduled expirations |
| `ticket-logs` | Ticket openings, claims/unclaims, renames, access changes, permanent ticket staff permissions, closures and HTML transcripts |

The bot does **not** send member message content to `audit-logs`. Ticket channel audit actions are filtered to reduce duplicate records. One close transcript is sent to `ticket-logs`; a second `Ticket Closed` card is not posted to moderation.

The legacy `blacklist-records` channel is no longer a write destination. Existing guild installations may archive it instead of deleting its history; `logChannels.blacklistChannelId` is retained as a legacy exclusion so changes inside a historical log channel are not mirrored as user message activity.

The exact channel IDs are configured per installation. Discord Gateway data can omit deleted message content, so the bot records missing content or uncertain attribution explicitly instead of inventing it. For Owner-only deletion exceptions, local evidence snapshots and restored-message metadata, see [Log integrity and recovery](LOG_INTEGRITY.md).

## Invite attribution

At startup, the bot snapshots invite usage counters. On new member joins, it compares the next snapshot with the previous one and attributes a join only if **exactly one known invite increases by one**, and its inviter is known. Unknown and ambiguous joins are recorded without an inviter. User leave events update the remaining-member count; rejoining does not inflate unique referral counts. The bot does not reconstruct historical join attribution from old invite usage totals.

## Design constraints

- Discord REST requests may fail or be rate-limited. Events must tolerate missing cache state and partial information.
- Discord's native Administrator permission overrides channel-level overwrites; ticket removals cannot fully exclude guild owners or Administrators.
- Secrets are not source files. Runtime databases, member data and logs must stay outside the repository.
- Production guild-specific migration scripts are **not** shipped publicly; configure static guild roles/channels separately.
