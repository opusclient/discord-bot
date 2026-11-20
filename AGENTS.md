# Opus System deployment authority

**SOLE PRODUCTION HOST: `nbi-edge-01` (NBI Edge 01).**

**REQUIRED INTERIM SSH ROUTE: local Mac → `nbi-core-01` (SSH jump host only) → `nbi-edge-01`.** The direct route is not available yet. Core 01 is permitted for SSH transit only; never deploy source, configure services, restart bots, store production runtime, or write application files on Core 01.

The machine-local record is `~/.config/opusclient/discord-bot-production.json`. Verify this policy before any production operation. Independently verify the jump server's `hostname -s` equals `nbi-core-01` and the final destination's `hostname -s` equals `nbi-edge-01`. Every deployment, service change, restart, or remote write must be addressed to Edge 01. Abort on any mismatch or connection failure; never fall back to Core 01.

Use the maintained Edge-only deployment path. Remove and never invoke obsolete Core-deployment scripts. A connection through Core 01 does not make Core 01 a deployment destination. If the route changes, require an explicit new instruction from the owner.

`npm run deploy` registers Discord guild slash commands; it is not infrastructure deployment. Do not confuse the two.
