# Contributing to Opus System

Thank you for helping improve the Opus Client Discord bot.

## Before opening a pull request

1. Search existing issues so work is not duplicated.
2. For security vulnerabilities, use private reporting as described in [SECURITY.md](SECURITY.md).
3. Fork the repository and create a focused branch.
4. Use a supported Node.js version and run `npm ci` and `npm test`.
5. Explain the behavior being changed, any permission implications, and how you tested it.

## Development rules

- **Never commit** `.env`, `config.json`, SQLite files, logs, transcripts, internal backups or real account identifiers.
- Use synthetic member/role/channel IDs in tests and examples.
- Keep slash commands guild-scoped and avoid exposing sensitive data in public replies.
- Keep Staff and Development role branches independent. Any changes to role hierarchy should add policy and integration tests.
- When changing ticket access, test both direct user overwrites and role-based access.
- Keep permission checks server-side. Hiding a button is not an authorization boundary.
- Prefer small, testable modules. Changes to events, database migrations or permissions should have regression coverage.
- New docs should accurately describe implemented behavior, not planned or hypothetical behavior.

## Pull request checklist

- [ ] `npm test` passes.
- [ ] No secrets, real IDs, production URLs or private data were added.
- [ ] Permission and security effects are described.
- [ ] Documentation matches changed behavior.
- [ ] Existing ticket and role invariants remain tested.

Maintainers may request revisions or close changes that introduce privacy, security, reliability or moderation risks.
