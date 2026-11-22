# TypeScript-only source policy

As of 2026-11-22, the source tree is TypeScript-only.

- `src/`: canonical backend TypeScript files.
- `web/dictate/*.ts`: canonical web editor source.
- `dist/`, `dist-web/`: generated JavaScript for the Node.js and browser runtime, excluded from Git.
- `tests/fixtures/config.test.json`: synthetic test config; live `.env`, `config.json`, databases and backups must never be committed.

All obsolete JavaScript source, including the former `legacy/` folder, was deleted. The previous source revision can be recovered from Git history. It is not loaded or tested by the current release pipeline.

Run `npm ci && npm run verify`. Verification enforces strict TypeScript compilation, checks generated JavaScript against the source inventory (including the 27 commands and 21 Gateway events), validates intentional-start guards, and runs the synthetic regression tests. No live Discord connection or command registration is performed.

## Production

NBI Edge 01 runs the compiled `dist/index.js` under `opus-system-bot.service`. JavaScript in `dist/` and `web/dictate/` is generated and is required for runtime. Do not delete compiled JavaScript from a running deployment.

The pre-TypeScript cutover backup and SQLite snapshots are preserved separately outside the application code tree, so a recovery can be reviewed without including old source in the active repo. No database reset, historical OAI replay, bot relogin or Discord notifications are authorized by source cleanup. Slash command changes still require `OPUS_TS_ALLOW_COMMAND_DEPLOY=1`.
