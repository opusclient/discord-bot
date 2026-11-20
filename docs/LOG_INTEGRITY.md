# Log integrity and recovery

Opus System protects evidence in the four active log channels — `audit-logs`, `moderation-logs`, `automod-logs`, `ticket-logs` — and the legacy `archived-blacklist-records` channel.

## Protection model

**Discord has a hard platform limitation:** the server owner and anyone with native **Administrator** permission can bypass normal channel overwrites. A Discord bot cannot make an Administrator's Delete action impossible. Instead, Opus System combines permission restrictions, persistent snapshots, detection and best-effort recovery.

| Control | Behavior |
| --- | --- |
| Channel restrictions | Denies Manage Messages, Manage Channels, Manage Threads, Manage Webhooks, Send Messages and thread creation/sending for non-owner roles and relevant member overwrites |
| Owner exception | Deletions attributed to the actual guild owner are exempt; owner-initiated bot purge commands explicitly register this intent |
| Message archive | Saves message content, embeds, author, original timestamp and attachment metadata to local SQLite |
| Attachment archive | Downloads supported Discord CDN attachments to a separate private directory; verifies SHA-256 before replay |
| Deletion events | Handles single-message and bulk deletions, including partial/cached message events |
| Deleted channels | Recreates protected log channels from saved metadata and replays available archived records |
| Downtime detection | Reconciles Discord history with stored snapshots on boot and every 15 minutes while connected |
| Incident trail | Records incident type, actor evidence, detection time, result and restored message IDs in SQLite; posts an alert to another log channel |

The bot denies deletion capabilities through Discord channel overwrites for ordinary members and Managers **without** the Administrator flag. Administrators still bypass those overwrites, so restoration depends on the bot remaining online and retaining its own permissions and archives.

## Recovery format

A recovered message is **never represented as the original Discord message**. Discord cannot recreate the original message ID, author or historical position. The bot posts a clearly marked replacement and includes:

- Original channel and message ID.
- Original author and timestamp, where available.
- Deletion event observation time and detection time.
- Recovery time, with UTC ISO timestamps including milliseconds.
- Deleting actor if a sufficiently matching Discord audit event exists, otherwise **Unknown**.
- Whether embeds, stickers, interactive components or attachments could not be reproduced.

The original content and embeds are sent separately, after the recovery marker. Downloads saved locally are included when they pass integrity checks and Discord accepts the re-upload. If the original payload was never captured, the bot creates an incident report explaining that it cannot reconstruct the content.

**Audit attribution has limits.** Discord does not attach the deleted message ID to every audit-log entry. A match on author, channel and nearby time is reported as a **recent audit match**, not mathematically certain per-message proof. Self-deletions may have no audit entry.

### Owner exception

The server owner is excluded from automatic restoration when an audit match identifies the owner, when the owner removes their own authored message without a competing audit match, or when the owner initiates a protected-channel purge through the bot. Owner-initiated channel deletions are recorded as exempt and remain exempt during later restart or missing-channel reconciliation.

During connection loss or an unavailable/ambiguous audit response, the bot may not be able to conclusively establish who deleted a message. In those cases the system favors preserving existing archived evidence and labels the actor as unverified. Owner actions during prolonged downtime cannot always be distinguished from other missing messages.

## Persistence

The SQLite archive is stored alongside the bot's runtime database, with attachments under `data/log-integrity/` by default. Override the attachment directory using `LOG_INTEGRITY_DIR` when appropriate. The archive directory is created with mode `0700` and attachment files with mode `0600`.

- Attachments are restricted to trusted Discord CDN origins.
- An individual attachment is limited to 100 MiB; each message has a 300 MiB attachment capture budget.
- Files larger than the limit, unavailable CDN files, stickers and interactive components are marked as incomplete.
- Backfill scans up to **10,000 messages per channel** in a pass. If history is larger or fetching fails, missing-message reconciliation is postponed for that channel rather than assuming uncaptured messages were deleted.
- The current archive has **no automatic deletion/retention policy**. Monitor disk utilization and back up the database and attachment directory together.

This archive protects against Discord-side deletions, **not** compromise of the host, database, backup filesystem or bot token. A hostile server administrator with SSH/root access, or an attacker who disables/revokes the bot, may still disrupt protection. Consider encrypted, access-controlled off-host backups if stronger evidence retention is required.

## Scope and limitations

The integrity service does not guarantee byte-for-byte reconstruction of Discord-native messages: the new message's ID and timestamp differ, and some content may be missing from an uncached deletion or expired CDN URL.

Archived evidence may include sensitive ticket transcripts, moderation cases and account identifiers. Do not publish `.env`, `config.json`, runtime SQLite, `data/log-integrity/` or incident logs.

The repository's tests simulate Owner exemptions, Manager deletions, bulk handling, attachment integrity, missing-snapshot alerts, channel recreation and boot reconciliation. These tests do not imply a destructive test has been run against a live production log.

## Related documentation

- [Architecture](ARCHITECTURE.md)
- [Operations](OPERATIONS.md)
- [Ticket confidentiality](TICKETS.md)
- [Security policy](../SECURITY.md)
