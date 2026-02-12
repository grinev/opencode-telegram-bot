# Contributing

Thanks for contributing to OpenCode Telegram Bot.

## Commit Message Convention

This project uses Conventional Commits for release note automation.

Format:

`<type>(<scope>)?: <description>`

Optional major marker:

`feat(<scope>)!: <description>`

Examples:

- `feat(keyboard): add robot icon for model button`
- `fix(model): handle model IDs with colons`
- `docs(readme): clarify setup steps`
- `feat(ui)!: redesign keyboard layout`

## Release Notes Mapping

Release notes are generated automatically from commit subjects.

Sections are shown only when they contain at least one item.

- `Major Changes`: `feat!` only
- `Changes`: `feat`, `perf`
- `Bug Fixes`: `fix`, `revert`
- `Technical`: `refactor`, `chore`, `ci`, `build`, `test`, `style`
- `Documentation`: `docs`
- `Other`: any subject that does not match the rules above

Additional rules:

- Merge commits are excluded.
- `chore(release): vX.Y.Z` commits are excluded.
- Notes use cleaned human-readable text (no commit hashes).

## Pull Requests

- Keep PRs focused and small when possible.
- Use clear titles that match the change intent.
- Ensure CI passes before requesting review.
