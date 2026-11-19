# Setup and configuration

This guide installs the Discord bot for an existing server. It does not automatically reproduce the Opus Client organization, roles or category layout.

## 1. Requirements

- Node.js **23.4+** and npm.
- A Discord application with a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
- A Discord server where you have permission to invite the bot and configure roles/channels.
- A host with a writable data directory for SQLite and ticket state.

Enable these **privileged Gateway intents** for the bot application: **Server Members**, **Message Content**, and **Presence**. The code requests `GuildMembers`, `MessageContent`, and `GuildPresences`; other requested intents include Guilds, GuildMessages, GuildModeration, GuildInvites, GuildVoiceStates and AutoModerationExecution.

## 2. Install the code

```bash
git clone https://github.com/opusclient/discord-bot.git
cd discord-bot
npm ci
cp .env.example .env
cp config.example.json config.json
```

Fill `.env`:

```dotenv
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
OPUS_LINK_WEBHOOK_SECRET=
OPUS_LINK_WEBHOOK_PORT=8789
```

The optional account-link secret must be strong and should be configured only when the backend integration is ready. `OPUS_OVERLAY_PORT` is optional for the separately enabled integration bridge.

**Never** paste these secrets into `config.json`, an issue, a commit or a screenshot.

## 3. Create roles and channels

Configure the server-side role hierarchy and static channels first. If `serverManagedByOpusManager` remains `true`, Opus System intentionally does **not** create or reorder your static server resources.

You can discover IDs through Discord Developer Mode or:

```bash
npm run ids
```

Do not paste IDs from `tests/fixtures/config.test.json` into production. They are fictitious test fixtures.

Required core configuration examples:

```json
{
  "guildId": "YOUR_GUILD_ID",
  "serverManagedByOpusManager": true,
  "roleBranches": {
    "staff": [
      "FOUNDER_ROLE_ID",
      "MANAGER_ROLE_ID",
      "ADMINSTRATOR_ROLE_ID",
      "MODERATOR_ROLE_ID",
      "SUPPORT_ROLE_ID"
    ],
    "development": [
      "PRINCIPAL_ENGINEER_ROLE_ID",
      "DEVELOPER_ROLE_ID"
    ],
    "specialties": [
      "BACKEND_DEVELOPER_ROLE_ID",
      "FRONTEND_DEVELOPER_ROLE_ID",
      "DISCORD_DEVELOPER_ROLE_ID"
    ],
    "founder": "FOUNDER_ROLE_ID",
    "manager": "MANAGER_ROLE_ID",
    "principal": "PRINCIPAL_ENGINEER_ROLE_ID",
    "developer": "DEVELOPER_ROLE_ID"
  }
}
```

This excerpt illustrates the shape; merge it into `config.json`, not a replacement for every configuration key.

### Important configuration groups

| Config key | Purpose |
| --- | --- |
| `guildId` | The guild where commands, events and policy apply |
| `roleBranches` | Logical Staff/Development ranks and specialty dependencies |
| `moderatorRoleIds`, `seniorModeratorRoleIds` | Approved moderation command authorities |
| `botControlRoleIds` | Operational bot-command authorities |
| `teamRoleIds` | Approved team roles for applicable features |
| `developmentAccessRoleId` | Restricted read/chat access for non-developer collaborators |
| `verifiedRoleId`, `linkedRoleId`, `unlinkedRoleId` | Account and verification state |
| `muteRoleId`, `modRoleId` | Mute and moderator integration |
| `tickets` | Panel, staff access, type categories, transcripts and archive |
| `modLogChannelId`, `auditLogChannelId`, `logChannels` | Moderation, audit, AutoMod and blacklist destinations |
| `verify`, `selfRoles`, `boosts`, `welcome` | Onboarding and community panels |
| `createVoice`, `serverStatsVoiceChannelId` | Temporary voice and server statistics |
| `overlay` | Optional integration; disable if unused |
| `serverManagedByOpusManager` | Disables competing static-layout management |

Any role IDs that form `roleBranches` must refer to existing, correct Discord roles. The bot validates these at runtime. Consult [PERMISSIONS.md](PERMISSIONS.md) before using promote/demote commands.

The **Discord Developer** specialty is a specially trusted role. Native Administrator must be configured deliberately for that role; do not give it to the Manager role as an accidental side effect.

## 4. Discord bot permissions

Invite the bot using the `bot` and `applications.commands` OAuth2 scopes. Assign a bot role above the roles it must manage.

Depending on enabled features, permissions include: View Channels, Send Messages, Read Message History, Manage Roles, Manage Channels, Manage Messages, View Audit Log, Attach Files, Embed Links, Add Reactions, Manage Webhooks as needed, Create Invite and applicable voice permissions.

Grant only necessary permissions for your server. For most servers, a separate moderation bot and a layout-manager bot are unnecessary; if you already use Opus Manager, give it ownership of the static structure as described above.

**Discord rule:** the bot cannot manage a role above its highest role or bypass guild-owner privileges, regardless of its code.

## 5. Test and register

```bash
npm test
npm run deploy -- --check
npm run deploy
npm start
```

`npm test` uses synthetic IDs and does **not** need a Discord token.

`npm run deploy -- --check` reads the configured guild command registry without changing it. `npm run deploy` registers the **24 guild commands**, removes obsolete guild commands and checks registration. The bot also reconciles command changes at startup.

The bot uses **slash commands**. An old prefix-support module may exist in the source for compatibility but prefix commands are not an alternative public command interface.

## 6. Check the installation

- Check logs for successful Discord login and command sync.
- Run `/help` in the configured guild.
- Confirm a new ticket can be created and then closed with a transcript.
- Confirm the owner/Manager/Moderator role restrictions reflect your own server.
- Check the bot can fetch invite snapshots if invite tracking is enabled.
- Review configured log channels and Discord permissions before inviting ordinary users.

For upgrades and backups, see [OPERATIONS.md](OPERATIONS.md).
