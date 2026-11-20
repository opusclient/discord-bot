# Opus System production environment

**Production: NBI Edge 01 (`nbi-edge-01`) exclusively.**

**Current access: Mac → NBI Core 01 (`nbi-core-01`, SSH jump only) → NBI Edge 01 (`nbi-edge-01`).** No direct production route has been established yet. Core 01 must not host or receive Discord bot source, production services, or runtime deployments.

## Mandatory preflight

1. Load `~/.config/opusclient/discord-bot-production.json` and confirm `environment=production`, `hostname=nbi-edge-01`, `connection.mode=ssh-proxyjump`, and `connection.jumpHostname=nbi-core-01`.
2. Verify the SSH jump server independently reports `hostname -s` = `nbi-core-01`.
3. Through that jump host, verify the actual production destination independently reports `hostname -s` = `nbi-edge-01`.
4. Validate the application directory, service, and expected runtime configuration **on Edge 01** before making changes.
5. If any check fails, stop. Never copy production code, run a bot service, or change a systemd unit on Core 01 as a fallback.

The legacy Core 01 deployment path is forbidden. Using Core 01 as an SSH transport hop is explicitly permitted and currently necessary. Only an explicit owner instruction can change the production destination or routing policy.

`npm run deploy` registers Discord guild slash commands; it is separate from deploying the production bot runtime.
