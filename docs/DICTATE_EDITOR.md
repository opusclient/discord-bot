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
