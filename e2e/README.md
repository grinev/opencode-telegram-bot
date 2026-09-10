# Browser-driven e2e checks

Drives the real bot through Telegram Web with Playwright MCP — no MTProto, no API
credentials. A persistent browser profile keeps the web session logged in.

Running the checks is the job of the `telegram-e2e-tester` subagent
(`.claude/agents/telegram-e2e-tester.md`). This file covers the one-time setup
a human does first.

## Files

| Path | What it is |
| --- | --- |
| `.env` | Test config you edit. Copied into the test home on every launch |
| `.env.example` | Template |
| `run-test-bot.ps1` / `.sh` | Starts the bot against an isolated home |
| `stop-test-bot.ps1` / `.sh` | Stops the test bot and its OpenCode server |
| `probes.js` | DOM probes and confirmed Telegram Web selectors |
| `scenarios/` | Regression scenarios the subagent runs before any feature check |
| `.tmp/e2e/home/` | Runtime state: `settings.json`, `logs/` |
| `.tmp/e2e/browser-profile/` | Persistent Telegram Web login |
| `e2e/output/` | Screenshots and console logs the subagent produces |

## One-time setup

1. **Test bot.** Create a separate bot with @BotFather. Do not use your
   production token — these runs create sessions and switch projects.

2. **Config.** Run `.\e2e\run-test-bot.ps1` once; it creates `e2e/.env` from the
   template and exits. Fill in `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_ALLOWED_USER_ID`, then run it again.

   Keep `BOT_LOCALE=en` — the probes match bot strings literally.

3. **Browser session.** The Playwright MCP server is declared inside the
   subagent, so the browser only exists while the subagent runs. Ask it to open
   `https://web.telegram.org/k/`, then scan the QR code from your phone once.
   Keep the Telegram Web interface in English. The session survives restarts;
   re-login is needed only every few months.

   Only one process at a time may use the browser profile. If a browser is
   already open on it, the subagent will fail with a profile-lock error.

4. **Update the peer id.** The subagent opens the chat by
   `data-peer-id`. If you use a different test bot, update that id in
   `.claude/agents/telegram-e2e-tester.md`.

## Running

```powershell
.\e2e\run-test-bot.ps1 -SkipBuild     # Windows
```

```bash
./e2e/run-test-bot.sh --skip-build    # macOS / Linux
```

Everything stays inside `.tmp/e2e/home`, so your real `.env`, `settings.json`
and `logs/` are untouched. Logs land in `.tmp/e2e/home/logs/`, one file per
launch.

OpenCode runs on the port from `OPENCODE_API_URL` in `e2e/.env` (4097 by
default) so test runs never collide with your own OpenCode on 4096.

When done:

```powershell
.\e2e\stop-test-bot.ps1               # Windows
```

```bash
./e2e/stop-test-bot.sh                # macOS / Linux
```

The subagent runs this itself at the end of every session. It only stops what
the test setup started: the OpenCode server on the configured test port, and
bot processes whose pid appears in a `.tmp/e2e/home/logs` file name.

The `.sh` scripts need the executable bit once they are committed:
`git update-index --chmod=+x e2e/run-test-bot.sh e2e/stop-test-bot.sh`

## Maintenance

Telegram Web changes class names between releases. When probes stop matching,
run the `discoverSelectors` probe from `probes.js` against a live chat and fix
the constants there. The selectors were last calibrated on 2026-07-27.

`@playwright/mcp` is pinned in the subagent's `mcpServers` frontmatter because a
newer release may require a newer Chromium revision than the one installed
locally. Screenshots go to `e2e/output/` (gitignored). Claude sets `--output-dir`
on the tester's `mcpServers`; OpenCode uses `.opencode/opencode.json`; OMP
picks Codex `.codex/config.toml` over OpenCode for the same server name.

`scenarios/` holds the regression scenarios. The subagent runs them before any
feature check, so a change that breaks the basic loop is caught before anything
else is judged. Today there is one, [`smoke.md`](./scenarios/smoke.md) — longer
scenarios get added as separate files next to it.

## What to test

Commands, features, and interaction routing rules are documented in
[`PRODUCT.md`](../PRODUCT.md). The feature scenario itself is passed to the
subagent per task, as behaviour only: it gets no diff and no implementation
detail, and writes its own cases.
