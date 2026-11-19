# Role hierarchy and permissions

This document describes the **implemented Opus System role policy**, separate from Discord's native permission bitfields. Always configure role IDs for your own server.

## Two independent branches

```text
Staff branch:
Founder > Manager > Adminstrator > Moderator > Support

Development branch:
Principal Engineer > Developer
                    ├── Backend Developer
                    ├── Frontend Developer
                    └── Discord Developer
```

`Adminstrator` is the spelling of the configured role in the original guild; do not silently rename its configuration key or ID.

**Important:** Discord's visual role positions and the two logical branches are different concepts. A Developer with a Staff role has **two responsibilities**: Development access and whatever moderation authority their Staff role actually grants. Neither responsibility alone automatically grants Staff Management or Development Management commands.

### Staff branch

| Position | Role policy |
| --- | --- |
| Founder | Top organization position; the actual guild owner is exempt from automatic role normalization |
| Manager | Highest ordinary operational authority; manages team roles using the bot and broad native channel/server permissions |
| Adminstrator | Highest ordinary Staff position below Manager |
| Moderator | Moderation duties and authorized ticket access |
| Support | Approved ticket support categories; not equivalent to unrestricted moderation |

Outside the owner exemption, only the highest applicable Staff rank remains on a member. A promotion or demotion clears conflicting or intermediate Staff ranks. Example: `Adminstrator + Moderator` demoted to `Support` becomes **Support only** on that branch.

When a Staff member is also an ordinary Developer, a Staff demotion does **not** remove their unrelated Development rank or specialty.

### Development branch

- **Principal Engineer** outranks Developer; it is not automatically combined with Developer or its specialties.
- **Developer** is the base rank for a development specialty.
- **Backend Developer**, **Frontend Developer**, and **Discord Developer** are configured specialties. A specialty requires the base Developer role.
- A normal member may combine Development and **one Staff rank**.
- Removing the base Developer role removes its dependent specialty roles.
- If a Principal Engineer role takes precedence in reconciliation, lower Developer/specialty roles are cleared.

#### Discord Developer exception

Discord Developer is **not equivalent to a regular Developer specialty** in native Discord authority:

1. It requires the base `Developer` role.
2. Its configured role has **native Discord Administrator** privileges.
3. It **cannot simultaneously hold a Staff branch rank**, including Manager.
4. If Discord Developer is assigned to a member with Staff ranks, reconciliation removes those Staff ranks.
5. Trying to add a Staff rank while Discord Developer is held is rejected by role policy.
6. This grants real Discord authority and should only be assigned to highly trusted personnel. Native Discord Administrator is distinct from Opus System command permissions.

## Delegated management roles

The two management roles delegate **permission to perform team role operations through Opus System**. They are **functional roles, not positions in the Staff/Development rank ladders**; each has zero native Discord permission flags.

| Functional role | Who may hold it | Bot permissions | Not granted |
| --- | --- | --- | --- |
| **Staff Management** | Trusted Adminstrator or member with an existing Principal Engineer/Developer rank | `/promote`, `/demote`, and `/role add/remove` when the roles being changed belong to **Staff** | Development branch management, server Administrator, native Manage Roles |
| **Development Management** | A selected **Manager** | Equivalent role operations within the **Development** branch, including Developer/specialist roles and ranks below the actor's Discord role | Staff branch delegation, server Administrator, native Manage Roles |

**Implicit authorities:**

- **Founder** (the guild owner) manages **both branches** without either management role.
- **Manager** manages **Staff** without Staff Management. Manager does **not** automatically manage Development; a Founder must appoint the selected Manager with Development Management because peers at the Manager hierarchy cannot modify one another.
- **Principal Engineer** automatically manages **Development** without holding Development Management. This does not automatically grant Staff Management.
- **Discord Developer** retains its configured exceptional Discord Administrator authority and is accepted for Development operations; it remains incompatible with Staff rank roles.
- A normal Adminstrator or Developer does **not** receive management commands merely from their rank.

**Delegation restrictions:** Only Founder/Manager can grant or revoke either management role using the bot. The selected recipient must already hold the qualifying rank. Neither role can be self-assigned by `/role add`, added to self-role buttons, or obtained via `/promote`. Removing the qualifying rank also removes the delegation at reconciliation. All actions still enforce bot and actor Discord hierarchy and are audited.

### Manager and native permissions

The deployed Opus Server Manager model provides:

| Capability | Manager |
| --- | --- |
| View and send in ordinary channels | Yes, through configured role permissions and channel overwrites |
| Manage channels, server configuration, webhooks and events | Yes, through specific native Discord permissions |
| View Audit Log; mention otherwise unmentionable roles | Yes, when configured |
| Use bot moderation and Staff role operations | Yes, subject to bot authorization and hierarchy |
| Manage Development branch | **Only when assigned Development Management** |
| Native Discord Administrator | **No** by default |
| Native Ban / Kick / timeout / Manage Roles | Not intended to be granted directly; actions go through Opus System |
| Self-manage functional roles | Only under the limited exception described below |

**Manager+ self-management:** Manager and Founder can use `/role add` and `/role remove` on themselves **only for independent functional roles**. They cannot self-change Staff or Development ranks or self-assign Discord Developer through this exception. The bot still checks actual role positions and its own authority.

Role hierarchy changes should not be made solely by changing the displayed role order. The configured Staff/Dev branch IDs define the logical ladder; Discord position checks control which mutations are technically permitted.

## Development Access

`Development Access` is a **restricted functional role** that grants the ability to read and chat in designated Development channels without making its holder a Developer.

- It is independent of both rank branches.
- It has no server-wide administrative permissions.
- The original guild grants it in `dev-chat`, `dev-updates`, `bug-testing`, `design-review` and `resources`, with the enclosing Development category.
- It is **not available** through self-role selection.
- Only **Founder or Manager** may grant/revoke it using Opus System commands.
- Assignment to a Founder, Manager or an existing Development-rank member is rejected as redundant.
- Reconciliation removes redundant Development Access when the holder gains a higher Development entitlement.

Example: A Moderator can be granted Development Access to collaborate with developers without acquiring the actual `Developer` role.

## Role operations

| Command | Purpose | Rules |
| --- | --- | --- |
| `/role add users role` | Assign a role to up to 50 members | Delegated management role required for team-branch changes; only Founder/Manager can assign management delegation roles |
| `/role remove users role` | Remove a role | May cascade dependent Developer specialties |
| `/promote users to_role [from_role]` | Move up a configured branch | Cannot silently demote or cross Staff/Development branches |
| `/demote users from_role [to_role]` | Move down or clear a branch | `from_role` is required and must match the active source rank |
| `/addselfrole`, `/removeselfrole` | Maintain public self-role choices | Never permits protected, identity or restricted access roles |

User lists support IDs and mentions. Operations are serialized by member, verified after updates and logged. Promote/demote history stores the initiator, source, destination, removed roles, reason and time for `/info`. Historical operations from before structured recording began do not magically appear in the database.

**The server owner** is protected from other members' role changes. Independent self-role actions by the owner are a narrowly allowed exception; the owner is not automatically normalized.

## Automated reconciliation

`GuildMemberUpdate` and startup audits enforce the Staff and Development branch policy. Reconciliation does not convert independent roles such as Artist, Beta Tester, Content Creator or ordinary account-status roles into Staff ranks.

An administrator editing roles manually can still trigger normalization; do not treat a manually modified role list as permanent until the policy has validated it.

## Ticket permissions are a separate layer

Ticket access is resolved by **channel permission overwrites**, not simply by the member's displayed rank.

- `/ticket remove user:@Member` explicitly denies that member's ticket access, even if multiple roles otherwise allow entry.
- `/ticket remove role:@Developer` removes only that role's channel access; a member with an additional Moderator role can still enter through the Staff overwrite.
- The ticket creator cannot be removed from their own ticket by normal ticket controls.
- Guild owners and native Discord Administrators bypass channel deny rules.

See [TICKETS.md](TICKETS.md) for the full model.

## Common scenarios

| Starting roles | Action | Outcome |
| --- | --- | --- |
| Developer + Backend Developer + Moderator | Demote Moderator to Support | Developer + Backend Developer + Support |
| Developer + Moderator | Remove Developer | Moderator (plus unrelated roles) |
| Principal Engineer + Adminstrator | Demote Adminstrator to Support | Principal Engineer + Support |
| Developer + Discord Developer | Add Moderator | Rejected |
| Manager | Add Development Access | Rejected: Development access is already available |
| Adminstrator + Staff Management | Promote Support to Moderator | Allowed, provided target is below Adminstrator in Discord hierarchy |
| Developer + Staff Management | Change a Development rank | Rejected without separate Development Management authority |
| Manager without Development Management | Promote Developer to Principal Engineer | Rejected until delegation is assigned |
| Manager with Development Management | Promote Developer to Principal Engineer | Allowed if role hierarchy permits |
| Principal Engineer without Development Management | Assign a Developer specialty | Allowed automatically |
| Moderator | Add Development Access via authorized Manager | Moderator + Development Access |
| Manager | Self-add Artist | Allowed subject to normal role checks |
| Manager | Self-add Discord Developer | Rejected |
| Member with Developer + Moderator permissions in a ticket | Remove Developer channel overwrite | Member keeps Moderator-based ticket access |
| Same member | Explicitly remove that user's ticket access | Member is denied despite both role grants |

## Who authorizes commands?

There are **two checks**: logical role policy and Discord/API authority.

1. Slash command and service code verify member permissions and/or approved role IDs.
2. Discord enforces role hierarchy and required permissions on the bot itself.

A role's position on a diagram does not grant unlisted Discord permission flags. Conversely, an Administrator flag can bypass restrictions that channel overwrites cannot enforce. Set privileges deliberately and keep higher-trust role assignment limited.
