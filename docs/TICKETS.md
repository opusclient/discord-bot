# Support tickets

Tickets are private Discord channels created by Opus System. The system uses a **single Components V2 support panel** with a category selector, status counters and three actions: **My Tickets**, **Ticket Status**, and **Support Guide**.

## Categories

| Category | Intended use |
| --- | --- |
| Priority | Urgent issues requiring staff attention |
| General | Community help and general questions |
| Technical Support | Launcher, client or installation problems |
| Bug Report | Reproducible client or launcher issues |
| Appeals | Requests to review moderation decisions |
| Account & Linking | Account access and Discord linking |
| Staff Application | Applying to work with the team |
| Purchases | Payments, plans and purchase questions |
| Security | Private vulnerability or security reports |

Category IDs are configured through `tickets.typeCategoryIds`. The bot does not silently invent static categories when `serverManagedByOpusManager` is enabled.

## Opening a ticket

1. Select the appropriate category in the panel.
2. Fill in the purpose modal.
3. The bot creates a channel inside the configured category and applies private permission overwrites.
4. The bot persists the channel ID, owner, purpose, category and numeric ticket number in SQLite.
5. Authorized staff may claim and respond.

Ticket numbering uses a guild-wide monotonically increasing sequence. Channels have names such as `0002-example`. Renaming retains the numeric identifier.

## Claims

- `/claim` claims an open ticket if the caller is authorized ticket staff.
- `/unclaim` releases a ticket claimed by the same staff member.
- Existing `/ticket claim` provides the legacy toggle action.
- Claiming the same ticket twice with `/claim` is rejected rather than silently unclaiming.
- Claim operations outside an open ticket are rejected.

## Permissions and the two remove behaviors

Ticket access uses Discord channel permission overwrites. User overrides and role overrides **must not be treated as equivalent**.

**Remove a specific person**

```text
/ticket remove user:@Example
```

The bot explicitly denies that person's View Channel, Send Messages, Read Message History and thread send permissions. This denial takes precedence even if the member holds Developer **and** Moderator. `/ticket add user:@Example` clears the applicable deny and grants access again.

**Remove one role's access**

```text
/ticket remove role:@Developer
```

The bot removes the role's ticket overwrite; it does **not** add a deny for all users who hold that role. A user who still holds Moderator can remain through Moderator's separate permission grant. Legacy tickets lacking relevant Staff overwrites may be repaired when role access is changed.

**Guild owners and native Discord Administrators cannot be excluded by ordinary ticket channel denies.** The ticket owner is protected against being removed from their own ticket by ordinary commands.

## Permanent role access

`/ticket add role:@Role scope:All tickets` grants a role permanent ticket-staff access for configured support workflows. `/ticket remove role:@Role scope:All tickets` removes that permanent configuration.

The default scope is **Current ticket**. A permanent role change requires authorized bot-management access and applies across the ticket workflows. `All tickets` is **not permitted** for a specific user.

## Closing and transcripts

Opening a ticket, claiming/unclaiming it, renaming it and changing its access create separate activity entries in `ticket-logs`. Permanent ticket staff access changes are also recorded there; these operations do **not** generate duplicate moderation cards.

Closing generates an HTML transcript and uploads it to the configured ticket logs. The bot keeps the ticket open if transcript generation or upload fails; losing the channel without a transcript is not treated as success. Ticket records maintain the final status and history.

Ticket messages can contain personal or security-sensitive information. **Do not grant the limited Support role access to the entire `ticket-logs` channel**, because it includes transcripts from Security and Appeals tickets outside Support's permitted categories. Restrict transcript logs to appropriately authorized staff. Never publish live transcripts or runtime SQLite data in GitHub.
