# Integrations

Opus System contains optional integration endpoints that are separate from the normal Discord slash commands.

## Signed account linking

The optional account-status callback lets a trusted account backend notify the bot when an already-verified Discord member links or unlinks their Opus account.

### Security boundaries

- Disabled unless `OPUS_LINK_WEBHOOK_SECRET` is configured.
- Listens on `127.0.0.1` by default, using `OPUS_LINK_WEBHOOK_PORT` (default `8789`).
- Endpoint: `POST /internal/account-link`.
- Requires an `x-opus-signature` header containing an HMAC-SHA256 signature of the **exact raw JSON body**, using the configured webhook secret.
- The implementation checks timestamps, replayed events, member identity and status ordering.
- The user cannot assign themselves `Linked` simply by pressing the Discord Verify button. The trusted backend must first verify account ownership.

Example request shape using **synthetic IDs**:

```json
{
  "guildId": "1900000000000000001",
  "userId": "1900000000000000002",
  "eventId": "example-link-event",
  "timestamp": 1793900000000,
  "linked": true
}
```

The signature must be calculated by the trusted backend. Do not forward unauthenticated public traffic to this endpoint. Rotate the secret if it is exposed.

## Overlay integration bridge

The codebase includes an optional, separately controlled pairing/session bridge in `src/services/overlayBridge.ts`. It is **not required** for using the Discord moderation or ticket bot.

- Controlled by `overlay.enabled` and related configuration.
- Supports short-lived pairing, bounded event payloads, token-based sessions and private log routing.
- The source of client-submitted events is not independently authenticated to a third-party game; do not present client-reported identity data as confirmed platform evidence.
- Keep the bridge disabled unless you have deployed and secured the associated client/service.
- Do not expose the listener publicly without TLS termination, request limits, rate limiting and access control.
- Some integration routes may not have a dedicated public slash command; the authoritative command registry is built from `src/commands/*.ts`.

This public repository intentionally omits original private hosting scripts and infrastructure routes. Other applications that interact with Opus System are not part of this Discord bot release.
