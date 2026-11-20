# Opus System production environment

**Production: NBI Edge 01 (`nbi-edge-01`) exclusively.**

**Direct SSH: `ssh -p 15564 root@14.241.111.182`.** Core 01 is not part of the deployment route.

## Mandatory preflight

1. Read `~/.config/opusclient/discord-bot-production.json` and require `environment=production`, `hostname=nbi-edge-01`, `connection.mode=ssh-direct`, host `root@14.241.111.182` and port `15564`.
2. Connect directly to the specified host and independently confirm `hostname -s` returns exactly `nbi-edge-01`.
3. Confirm the correct production directory, service, runtime configuration and existing backups on Edge 01.
4. Abort on any failed check. Never deploy, restart or modify Discord bots on Core 01.
5. Preserve production configuration and data. Back up changed source before upload and validate the bot after deployment.

`npm run deploy` registers Discord slash commands only; it does not deploy the bot runtime.
