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

## Branch Naming Convention

Use the following branch name format:

`<type>/<short-description>`

Examples:

- `feat/model-selector`
- `fix/session-timeout`
- `docs/contributing-branch-rules`

Rules:

- Use lowercase letters and kebab-case only.
- Use only `a-z`, `0-9`, and `-`.
- Keep `short-description` concise (2-6 words).
- Recommended `type` values: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, `build`, `perf`, `hotfix`.

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

## Version Bump Checklist

This repository is currently in `0.x`, but version bumps still follow a strict SemVer-style policy:

- **Patch (`0.1.1 -> 0.1.2`)**
  - Bug fixes (`fix`)
  - Small UX polish that does not change expected behavior
  - Internal/release/docs/test/ci updates (`chore`, `refactor`, `docs`, `test`, `ci`, `build`, `style`)
  - No breaking changes

- **Minor (`0.1.1 -> 0.2.0`)**
  - New user-visible functionality (`feat`)
  - Meaningful behavior improvements users are expected to notice
  - Additive changes that remain backward-compatible

- **Major (`0.x -> 1.0.0` or `1.x -> 2.0.0`)**
  - Breaking changes that require migration
  - Contract/API changes that can break existing setups
  - Reserved for explicitly planned compatibility breaks

Quick decision rule:

- Mostly fixes/infra/docs -> patch
- At least one clear user-facing feature -> minor
- Any intentional breakage -> major

## Pull Requests

- Keep PRs focused and small when possible.
- Use clear titles that match the change intent.
- Ensure CI passes before requesting review.

### PR Quality Bar

**MUST**
- PR branch must be up to date with `main` HEAD and conflict-free.
- CI must pass (`npm run lint`, `npm run build`, `npm test`).
- Changes must be compatible with both macOS and Windows (our primary supported platforms).
**SHOULD**
- Keep PRs focused and small.
- Add or update tests for behavior changes.
- Describe user-visible impact in 1-2 lines.
- If you could not test on one platform locally, mention it in the PR description.