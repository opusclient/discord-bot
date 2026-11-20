# Opus System deployment authority

**SOLE PRODUCTION HOST: `nbi-edge-01` (NBI Edge 01).**

**REQUIRED SSH ROUTE: Mac → `root@14.241.111.182:15564` directly.** Do not use NBI Core 01 as a proxy or a deployment destination.

Before every production operation, read `~/.config/opusclient/discord-bot-production.json`. Require `environment=production`, `hostname=nbi-edge-01`, `connection.mode=ssh-direct`, `connection.productionSshTarget=root@14.241.111.182` and `connection.productionSshPort=15564`.

Independently run `hostname -s` on the actual destination and require the exact result `nbi-edge-01`. Abort if the connection or identity check fails. Never fall back to any other machine. Check the production directory and service before changing anything.

`npm run deploy` registers guild slash commands with Discord; it is not an infrastructure deployment. Use it only after confirming application identity and the intended production server.
