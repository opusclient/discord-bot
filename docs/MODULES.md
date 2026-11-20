# Opus System module architecture

Opus System is a **modular monolith**: one Discord Gateway process, one runtime configuration, and one SQLite database, with code organized into explicit feature-owned modules. A module is an internal code boundary, **not** a separate bot or service.

## Module catalog

| Module | Ownership | Slash commands | Core services |
| --- | --- | --- | --- |
| **OAI — Opus Authority Integrity** | Authorized role state, history, drift detection, incidents and Founder/Manager review | None | authorityDecisions, roleIntegrity |
| **Management** | Staff and Development hierarchies, role operations, delegation and personnel history | /role, /promote, /demote | roleBranchPolicy, roleBranchService, teamManagement, roleOperations |
| **Moderation** | Warnings, mutes, bans, kicks, cases, escalation and purge | /warning, /mute, /unmute, /kick, /ban, /unban, /blacklist, /purge, /punishments | mutes, scheduler, escalation |
| **Verification** | New-member verification, account role status and linking | /verify | verify, accountLinkWebhook |
| **Tickets** | Support tickets, claims, staff visibility and transcripts | /ticket, /claim, /unclaim | tickets |
| **Community** | Profiles, invites, self roles, welcome, boosts and voice | /info, /invites, /addselfrole, /removeselfrole | memberProfile, inviteTracker, selfroles, createvoice |
| **Communications** | Announcement editing, private web editor and publish flow | /dictate | dictate, dictateWeb |
| **Observability** | Server audit, moderation logs, log recovery and status | None | auditlog, guildAuditEvents, logIntegrity |
| **Integrations** | Optional external bridges and account integrations | None | overlayBridge, accountLinkWebhook |
| **Operations** | Setup, command sync, help and bot runtime | /help, /install, /setup, /uninstall, /restart | install, restart, slashSync |

**Total:** 10 modules and 26 top-level slash commands, each command with exactly one owner. Gateway events can legitimately involve several modules.

## Project layout

~~~text
src/
  modules/
    registry.js
    oai/
      index.js
      api.js
      README.md
    management/
      commands/
      index.js
      api.js
      README.md
    moderation/
    verification/
    tickets/
    community/
    communications/
    observability/
    integrations/
    operations/
  commands/
  events/
  services/
  ticket-actions/
  utils/
  config.js
  db.js
  index.js
  deploy-commands.js
~~~

Each module exposes an **index.js manifest** with its ID, title, purpose, command ownership, service ownership and participating events. Actual command implementations live in that module's **commands/** directory. The central **src/modules/registry.js** loads the declarations, validates ownership and supplies the command registry used by the runtime and guild slash registration.

Existing **src/commands/** paths remain as compatibility re-exports while consumers transition; do not add new command implementations there. The **/punishments** implementation is temporarily preserved in its existing source location because separate, unfinished OAI work currently modifies it. Its module command entry delegates to that original source without duplicating the logic.

Each module's **api.js** provides stable namespace exports for its services. The service implementations remain under **src/services/** during this migration so ongoing changes to authorization, event handlers and persistence are not disrupted. The module manifests and APIs establish ownership but do not imply all service files have already been relocated.

## Architectural rules

1. **Commands and events are adapters.** Their job is to parse Discord interactions and call domain services. They must not duplicate role authorization, case changes or persistent state transitions.
2. **Module services own their business rules.** Cross-domain dependencies should use the other module's API facade, not import arbitrary implementation internals.
3. **Shared infrastructure** (config, database and utilities) is not an alternative authorization path.
4. **No duplicate registration.** One slash command name must appear in exactly one module manifest, and the exported command name must match that manifest.
5. **Preserve existing data and runtime contracts.** Moving source files must never reset the SQLite database, rename production roles or silently change permissions.
6. **OAI is not Management.** A legitimate Management request still passes the applicable role-integrity checks. OAI owns integrity review and audit evidence, rather than assuming anyone with Discord permission is automatically authorized.
7. **Observability is not authority.** Logs supply evidence; they do not grant or approve role mutations.
8. **Only the verified Edge 01 production host may run bot deployments.** Direct SSH is configured in the production policy. Core 01 is not a deployment destination.

## OAI and Management boundary

**Management** is responsible for role eligibility, Staff/Development branching, rank hierarchy, delegation, promotions and demotions. **OAI** is responsible for detecting role-state drift outside approved history and providing a controlled review and restoration path.

The OAI implementation is actively being developed in the existing authorityDecisions and roleIntegrity services. Its ownership is documented here; do not rewrite, move or silently merge those in-progress files to satisfy folder structure. Founder override, incident state transitions and history authorization must be verified against the actual implementation before changing production policy.

## Contributor workflow

1. Identify the owning module from the catalog.
2. Add slash-command implementation under that module's commands directory and declare it exactly once in its manifest.
3. Add a compatibility re-export only for a documented existing consumer.
4. Expose cross-domain service functionality through the module's API facade.
5. Validate the module registry and verify that the old and new command entry points resolve identically.
6. Document any new permission, config key, database migration or external integration in the relevant documentation.
7. Follow the direct SSH policy in [Production](PRODUCTION.md).

## Migration status

The module folders, command ownership registry and grouped command implementations are operational. OAI and Management have distinct module contracts and documentation. Existing service implementations and Gateway event handlers are still kept in their historical directories until they can be migrated safely. This staged approach intentionally preserves concurrent uncommitted OAI work.
