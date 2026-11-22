# Commands and features

Opus System registers **27 guild-scoped slash commands**. The table below groups the top-level commands by purpose. A command with subcommands appears only once in the registered top-level count.

## General and community

| Command | Purpose |
| --- | --- |
| `/verify` | Verify your own account manually and unlock member channels; same eligibility rules as the Verify button |
| `/help` | Components V2 command browser with scoped navigation |
| `/info [user]` | Member profile: avatar, server join date, account age, role positions, promotion/demotion history and invites |
| `/invites [user]` | Verified invite attribution: total invited, still in guild, left and currently active links |

Invite tracking only credits a new join when the invite-use difference is unambiguous. It does not reconstruct member joins from a link's historical usage count.

## Announcements

| Command | Purpose |
| --- | --- |
| `/dictate` | Private HTTPS editor with live preview and cursor-positioned user, role and channel mentions; one-time Publish after a permission re-check |

Access: Founder, Manager and Adminstrator; other team ranks are not automatically authorized. See [Dictate web editor](DICTATE_EDITOR.md).

## Tickets

| Command | Purpose |
| --- | --- |
| `/ticket open` | Show the nine-category support panel |
| `/ticket status` | Show your most recent active ticket |
| `/ticket add user|role [scope]` | Add an individual or role to a ticket |
| `/ticket remove user|role [scope]` | Remove an individual or role from a ticket |
| `/ticket claim` | Existing ticket-claim control |
| `/ticket rename name` | Rename the current ticket |
| `/ticket close [reason]` | Close the ticket with an HTML transcript |
| `/claim` | Claim the current ticket, staff only |
| `/unclaim` | Release a ticket that you claimed |

For `/ticket add` and `/ticket remove`, `scope:Current ticket` is the default. `scope:All tickets` is permitted **only for roles**, and requires additional authorization. Read [TICKETS.md](TICKETS.md) for the access precedence rules.

## Moderation

| Command | Purpose |
| --- | --- |
| `/warning` | Warn a member and record a case |
| `/mute`, `/unmute` | Apply or remove a mute |
| `/kick` | Remove a member from the guild |
| `/ban`, `/unban` | Ban or unban a user |
| `/blacklist` | Record a blacklist case (enforcement behavior is configuration-dependent) |
| `/purge` | Remove messages with permission checks |
| `/punishments view` | Review user punishment/case history |
| `/punishments clear` | Clear an active case while retaining the record |

Cases, audit messages and expirations have their own destinations. Discord AutoMod rules themselves are configured in Discord, while the bot records supported AutoMod events.

## Team and roles

| Command | Purpose |
| --- | --- |
| `/role add`, `/role remove` | Batch role changes with hierarchy checks |
| `/promote` | Promote within a logical Staff or Development branch |
| `/demote` | Demote within a branch or clear its roles |
| `/addselfrole`, `/removeselfrole` | Configure the public opt-in role panel |
| `/customrole create`, `/customrole delete`, `/customrole list` | Manage non-hoisted, non-mentionable custom color roles |

The Staff and Development branch rules, delegated **Staff Management** / **Development Management** roles, automatic Principal Engineer permissions, Manager+ self-role exception, Discord Developer special case and Development Access restrictions are in [PERMISSIONS.md](PERMISSIONS.md).

## Operations

| Command | Purpose |
| --- | --- |
| `/install` | Refresh/install configured bot-owned resources |
| `/setup` | Inspect or run applicable setup operations |
| `/uninstall` | Remove bot-managed resources as authorized |
| `/restart` | Request a bot restart from an authorized operator |

These are operational controls, not normal member features. Their behavior respects `serverManagedByOpusManager`; the static guild layout is owned by the configured layout manager.

## Visibility and authorization

- Slash replies are **public by default**; commands expose the optional `hide: Yes` setting for an ephemeral result.
- Some buttons, account-related interactions and ticket-member lists are intentionally private regardless of slash defaults.
- Calling a command never bypasses the caller's authorization, Discord role hierarchy or the bot's own effective permissions.
- The `/help` interface is a discovery aid, **not** an authorization boundary.
- Punishment case details and reason visibility may be further restricted to staff or private output.

Typed command implementations live in `src/commands/`. The executable registry loads compiled definitions from `dist/commands/`. See [Modules](MODULES.md).
