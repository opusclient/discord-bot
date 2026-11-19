# Security policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for a previously undisclosed vulnerability. Use the repository's **Private vulnerability reporting** feature in GitHub Security when available. Include affected versions, relevant files, safe reproduction conditions and impact; do not include real users' private data or live tokens.

If private reporting is unavailable, contact the project maintainers through the repository's published support channels and request a private reporting route before sharing exploit details.

## Data and credentials

Runtime data can contain Discord account identifiers, moderation case history, ticket transcripts, invitation attribution and other sensitive operational information. Treat these as private data.

- Keep Discord tokens and webhook HMAC secrets in environment variables, outside Git.
- Use a separate bot token for each application; never reuse an unrelated manager bot's token.
- Never commit `.env`, `config.json`, backups, logs, transcripts or production SQLite.
- Do not grant the bot more Discord permissions than its enabled features require.
- Protect the host, file permissions, SQLite database and log retention policy.
- Signed account-link callbacks must authenticate the source and run behind a trusted network boundary.
- Enable MFA on GitHub and Discord accounts that can deploy or administer the bot.

## Scope

The repository includes optional integration code and guild-specific permission logic. Review and adapt configuration before hosting it elsewhere. A successful test suite does not replace production security review.
