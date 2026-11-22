# TypeScript source policy

As of 2026-11-22, TypeScript is the **sole maintained source language** for Opus System.

- `src/`: 117 canonical TypeScript backend files, including commands, services, events and utilities.
- `web/dictate/`: two TypeScript browser source files and the HTML/CSS assets.
- `legacy/src/` and `legacy/web/`: preserved historical JavaScript for parity and rollback. These folders are never imported by production.
- `dist/` and `dist-web/`: ignored build output.
- `tests/fixtures/config.test.json`: synthetic test configuration. Real configuration, credentials, databases and backups are never committed.

Use `npm ci && npm run verify`. Strict typechecks, 27-command/21-event parity, intentional-start guards and all regression tests must pass. At migration, 280 tests passed against both JavaScript and TypeScript on a clean Git checkout.

## Production

Production cutover to `dist/index.js` on NBI Edge 01 was completed on 2026-11-22. The user service supplies `OPUS_TS_CUTOVER=1`. A protected pre-cutover database snapshot, legacy source archive and sidecar data are retained outside Git. Rollback may restore the JavaScript runtime without overwriting newer database records.

Source reorganization is not permission to launch a second bot, register slash commands, reset OAI baselines, reconstruct historical incidents or issue ghost pings. Deliberate command registration requires `OPUS_TS_ALLOW_COMMAND_DEPLOY=1`; `npm run deploy -- --check` is read-only.

Maintain root `src/` as TypeScript. Do not reintroduce a nested `typescript/src/` or JavaScript modules under root `src/`.
