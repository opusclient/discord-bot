# Dictate web editor

The `/dictate` command provides a private web editor for bot-authored announcements.

## Workflow

1. Founder, Manager or Adminstrator invokes `/dictate`.
2. Opus System responds privately with an **Open Web Editor** link.
3. The editor loads channels the operator may view and the bot may publish to.
4. Compose an Embed or Markdown text, customize its title and color, and add mentions using **User / Role** and **Channel** pickers.
5. The selected mention token is inserted at the textarea's cursor or replaces its current selection. It can be moved and edited as normal text.
6. A live preview displays the message, including user, role and channel references.
7. Review the target and confirm Publish. The bot validates every permission again, posts the message, and records the operator in audit logs.

The legacy Discord Modal is retained as a fallback if no valid HTTPS editor origin is configured.

## Hosting

Opus System starts its own HTTP server bound to `127.0.0.1` on port `8791` by default. Provide a separate HTTPS reverse proxy or secure named tunnel.

```dotenv
DICTATE_EDITOR_PORT=8791
DICTATE_EDITOR_PUBLIC_URL=https://editor.example.com
```

Route paths `/dictate/`, `/dictate/editor.css`, `/dictate/editor.js`, `/dictate/api/session` and `/dictate/api/publish` to that server.

Use a dedicated HTTPS hostname; do not publish port `8791` directly. Cloudflare Quick Tunnels may be used for development, but their randomly generated hostnames can change and they have no uptime guarantee. For ongoing operation, use a persistent domain and account-managed tunnel or reverse proxy.

## Security and authorization

- Only guild Owner, Manager or Adminstrator may create a session.
- Each link contains a cryptographically random, single-use, 15-minute bearer token. Only its SHA-256 hash is stored in the running bot's memory.
- The token is carried in the URL fragment and removed from browser history when the editor opens. It is transmitted only as an Authorization header to the same-origin API.
- The session is invalidated on successful publication, expiry or bot restart.
- The API verifies membership and staff permissions on every request. It rechecks channel visibility, the bot's Send Messages permission, all mentioned user IDs, visible channels and role mentionability before publishing.
- System audit, moderation, AutoMod, blacklist archive and ticket log channels cannot be selected as destinations.
- The server does not enable cross-origin browser access, and Publish requires the expected Origin header.
- Mass mention parsing is disabled. Only explicitly validated user and role IDs can be notified; `@everyone` and `@here` do not ping.
- Publication is guarded against simultaneous duplicate requests.
- The command reply is ephemeral. **Do not share its link**: possession of the token grants access to that editor session until it is used or expires.

## Editor details

The composing surface is a normal textarea to preserve cursor positions and keyboard editing. The selection is saved while browsing references, and an insertion updates the text, selection, preview and mention count immediately. If no prior cursor position is available, the mention is appended. The User/Role and Channel buttons open searchable lists. Channel references include visible voice, stage, forum and media channels, not just channels available as publishing destinations. A selected item is inserted as an actual Discord mention token: `<@userId>`, `<@&roleId>` or `<#channelId>`.

The preview is local and does not ping anyone. Role options that the operator cannot mention are hidden. The final output may differ slightly from the preview for Discord-specific layouts, attachments or mention rendering.

Limits: 2,000 characters for Markdown text and 4,000 characters for embed description. Embed titles are limited to 256 characters. Publication requires a nonempty body.

## Diagnostics

- `GET https://your-editor-host/dictate/` should return **200**.
- `GET https://your-editor-host/dictate/api/session` without a bearer token should return **401**.
- If `/dictate` opens the legacy Modal, ensure `DICTATE_EDITOR_PUBLIC_URL` is configured and valid.
- If the page cannot load session data, the link may have expired, already published, or the bot may have restarted.
- If role mentions cannot be selected, check whether the actor is allowed to mention those roles.
- If a publication fails, recheck guild membership, destination channel permissions and whether the bot can send to that channel.

No Discord message is sent until the user explicitly confirms publication.

## Private token-scoped draft access

Each invocation of `/dictate` creates a fresh 256-bit bearer token in the link fragment and a separate draft held in bot process memory. Only a SHA-256 digest of the token is kept server-side. The token expires after 15 minutes, on publication, or when the bot restarts.

The public `/dictate/` address serves only an access-checking loader. The actual editor interface is returned by `GET /dictate/api/editor` only after validating the bearer token and current Discord staff privileges. Direct unauthenticated requests cannot retrieve the composing UI or any draft.

`GET /dictate/api/session` returns only the matching token's draft and its version. `PUT /dictate/api/draft` saves that draft after origin, token, membership, format and version checks. Competing stale updates return HTTP 409. `POST /dictate/api/publish` requires the saved version and publishes the stored draft, not arbitrary message content submitted at publish time.

The link token stays out of HTTP URLs because it is placed in the fragment; the browser removes it from the address bar and keeps it in memory, not in localStorage or cookies. To reopen a draft after reloading, use the original private Discord link while it is still valid. Never share this link: anyone possessing the token can open its draft during its lifetime.

The bootstrap JavaScript and stylesheets are not secret; the actual composition markup and session data remain protected.

## Image attachments

Upload PNG, JPG, GIF or WebP directly from the private editor or drop files onto the image panel. Embed messages support one attached image, displayed inside the embed below its text. Plain text messages support up to 10 images displayed below the text. Each image is limited to 8 MB and each private session to 24 MB total. Uploads are bound to the 15-minute token, verified before publication and discarded when that session expires, publishes or the bot restarts. Images can be removed before publishing.
