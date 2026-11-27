# Smoke: the bot answers in a fresh session

The basic loop: the bot starts, a new session is created, a prompt goes to
OpenCode, and the reply comes back rendered in Telegram.

Run this **first, before the feature cases**. The build already contains the
change under test, so a failure here is a regression in the basic loop — and it
also means the feature verdict would be meaningless. Stop and report instead of
continuing.

Cost is deliberately minimal: one short prompt, no tool calls.

## Preconditions

- The bot was started from a fresh build (`.\e2e\run-test-bot.ps1`, no
  `-SkipBuild`) and printed `Bot @... started!`.
- OpenCode is up. If `/status` says the server is down, `/opencode_start` from
  the chat brings the stand's server up on the test port. That start does not
  replace the user's OpenCode server. Do not start `opencode serve` by hand.
- The bottom keyboard shows the project under test and an allowed model.

## Steps

1. Send `/new`.
2. Send `Reply with exactly: ready`.
3. Poll `probeState` until it reports `finished`.
4. Read the log delta from the offset noted before step 2.

## Pass criteria

- `/new` is confirmed and the 📋 row shows the project and the new session.
- The run reaches `finished` — the `{agent} · 🧠 {model} · 🕒 {duration}`
  footer, in compact and normal mode alike.
- The assistant produced a non-empty text reply.
- The bottom keyboard still shows the expected project and model. Tapping 📋
  sends a fresh dashboard with the session's context; Close removes just that card.
- The log delta contains no `[ERROR]`.

## Notes

Assert structure, not wording — the model may add punctuation or a greeting
around `ready`. If the run stalls at `idle` for 30s+ after step 2, it never
started: read the log instead of polling further.
