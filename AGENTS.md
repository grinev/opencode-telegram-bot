# AGENTS.md

Instructions for AI agents working on this project.

## About the project

**opencode-telegram-bot** is a Telegram bot that acts as a mobile client for OpenCode.
It lets a user run and monitor coding tasks on a local machine through Telegram.

Functional requirements, features, and development status are in [PRODUCT.md](./PRODUCT.md).

## Technology stack

- **Language:** TypeScript 5.x
- **Runtime:** Bun >= 1.4.0
- **Package manager:** Bun (`bun install`)
- **Test runner:** `bun test` (vitest API shimmed through the `#vitest` subpath alias in `package.json` `imports`, which resolves to `tests/helpers/vitest-shim.ts`)
- **Configuration:** environment variables (`.env`)
- **Logging:** custom logger with levels (`debug`, `info`, `warn`, `error`)

### Core dependencies

- `grammy` - Telegram Bot API framework (https://grammy.dev/)
- `@grammyjs/menu` - inline keyboards and menus
- `@opencode-ai/sdk` - official OpenCode Server SDK
- `dotenv` - environment variable loading
- `bun:sqlite` - native SQLite (replaces `better-sqlite3` for the session cache fallback)

### Test dependencies

- `bun:test` (`describe`, `test`, `expect`, `mock`, `spyOn`, `setSystemTime`, `jest`)
- A vitest-compatible `vi` namespace exported from `tests/helpers/vitest-shim.ts` so existing test files can keep `import { vi } from "vitest"`

### Code quality

- ESLint + Prettier (run via `bunx`, no node)
- TypeScript strict mode
- `bun run check` runs lint + build + tests

## Architecture

### Main components

1. **Bot Layer** - grammY setup, middleware, commands, callback handlers
2. **OpenCode Client Layer** - SDK wrapper and SSE event subscription
3. **State Managers** - session/project/settings/question/permission/model/agent/variant/keyboard/pinned
4. **Summary Pipeline** - event aggregation and Telegram-friendly formatting
5. **Process Manager** - local OpenCode server process start, stop, and status
6. **Runtime/CLI Layer** - runtime mode, config bootstrap, CLI commands
7. **I18n Layer** - localized bot and CLI strings to multiple languages

### Data flow

```text
Telegram User
  -> Telegram Bot (grammY)
  -> Managers + OpenCodeClient
  -> OpenCode Server

OpenCode Server
  -> SSE Events
  -> Event Listener
  -> Summary Aggregator / Tool Managers
  -> Telegram Bot
  -> Telegram User
```

### State management

- Persistent state is stored in `settings.json`.
- Active runtime state is kept in dedicated in-memory managers.
- Session/project/model/agent context is synchronized through OpenCode API calls.
- The app is currently single-user by design.

## AI agent behavior rules

### Communication

- **Response language:** Reply in the same language the user uses in their questions.
- **Clarifications:** If plan confirmation is needed, use the `question` tool. Do not make major decisions (architecture changes, mass deletion, risky changes) without explicit confirmation.

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

### Git

- **Commits:** Never create commits automatically. Commit only when the user explicitly asks.

### Windows / PowerShell

- Keep in mind the runtime environment is Windows.
- Avoid fragile one-liners that can break in PowerShell.
- Use absolute paths when working with file tools (`read`, `write`, `edit`).

## Coding rules

### Bun-native APIs (no `node:*` imports in `src/`)

This fork is bun-native at the file-I/O and process layer. The source code does not import from `node:fs`, `node:fs/promises`, `node:child_process`, `node:util`, `node:url`, `node:os`, `node:http`, `node:https`, `node:crypto`, or `node:readline`. Use the bun-native equivalents:

| Use | Instead of |
| --- | --- |
| `Bun.file(path)` / `Bun.write(path, data)` / `Bun.file(path).delete()` | `node:fs/promises` read/write/unlink |
| `Bun.Glob` | `fs.readdir` (for directory listings) |
| `Bun.file(path).stat()` | `fs.stat` |
| `Bun.file(path).text()` / `.json()` / `.arrayBuffer()` | `fs.readFile(path, "utf-8")` |
| `Bun.spawn([...])` / `Bun.spawnSync([...])` | `child_process.spawn` / `exec` / `promisify(exec)` |
| `Bun.spawn(["mkdir", "-p", path])` | `fs.mkdir(..., { recursive: true })` (no bun-native API for directory creation) |
| `Bun.CryptoHasher` | `crypto.createHash` |
| `crypto.randomUUID()` (global) | `crypto.randomUUID` from `node:crypto` |
| `Bun.inspect` | `util.inspect` |
| `fetch` (global) + `proxy` option | `node:http` / `node:https` + `https-proxy-agent` / `socks-proxy-agent` |
| `Bun.fileURLToPath` | `fileURLToPath` from `node:url` |
| `bun:path` | `path` from `node:path` |
| `process.env.HOME` / `process.env.USERPROFILE` | `os.homedir` |
| `for await (const line of console)` (line) or `Bun.stdin.stream()` (char) | `readline` / `readline/promises` |

### Language

- Code, identifiers, comments, and in-code documentation must be in English.
- User-facing Telegram messages should be localized through i18n.

### Code style

- Use TypeScript strict mode.
- Use ESLint + Prettier.
- Prefer `const` over `let`.
- Use clear names and avoid unnecessary abbreviations.
- Keep functions small and focused.
- Prefer `async/await` over chained `.then()`.

### Error handling

- Use `try/catch` around async operations.
- Log errors with context (session ID, operation type, etc.).
- Send understandable error messages to users.
- Never expose stack traces to users.

### Bot commands

The command list is centralized in `src/bot/commands/definitions.ts`.

```typescript
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "help", descriptionKey: "cmd.description.help" },
];
```

Important:

- When adding a command, update `definitions.ts` only.
- The same source is used for Telegram `setMyCommands` and help/docs.
- Do not duplicate command lists elsewhere.

### Logging

The project uses `src/utils/logger.ts` with level-based logging.

Log files:

- In source mode logs are stored `<project root>/logs` by default.
- Each source-mode bot run writes to a separate file named `bot-YYYY-MM-DD_HH-MM-SS_<pid>.log`.
- The `logs/` directory is gitignored, so search inside it directly: use `path: "logs"` with `pattern: "*.log"`.
- Installed mode writes under the installed app home `logs` directory and uses daily files named `bot-YYYY-MM-DD.log`.

Levels:

- **DEBUG** - detailed diagnostics (callbacks, keyboard build, SSE internals, polling flow)
- **INFO** - key lifecycle events (session/task start/finish, status changes)
- **WARN** - recoverable issues (timeouts, retries, unauthorized attempts)
- **ERROR** - critical failures requiring attention

Use:

```typescript
import { logger } from "../utils/logger.js";

logger.debug("[Component] Detailed operation", details);
logger.info("[Component] Important event occurred");
logger.warn("[Component] Recoverable problem", error);
logger.error("[Component] Critical failure", error);
```

Important:

- Do not use raw `console.log` / `console.error` directly in feature code; use `logger`.
- Put internal diagnostics under `debug`.
- Keep important operational events under `info`.
- Default level is `info`.

## Testing

### What to test

- Unit tests for business logic, formatters, managers, runtime helpers
- Integration-style tests around OpenCode SDK interaction using mocks
- Focus on critical paths; avoid over-testing trivial code

### Test structure

- Tests live in `tests/` (organized by module)
- Use descriptive test names
- Follow Arrange-Act-Assert
- Use `vi.mock()` for external dependencies (works through the shim — at runtime it routes to `bun:test`'s `mock.module()`)

### Test runner notes

- `bun test` discovers `tests/**/*.test.ts` by default.
- `bunfig.toml` loads `tests/setup-preload.ts` (a no-op forward-compat hook) and `tests/setup.ts` (per-test env defaults + singleton reset).
- Test files import from `"#vitest"`, which is a subpath alias defined in `package.json` `imports`. This avoids bun's built-in vitest namespace (which is intentionally limited) and routes every `import { vi } from "vitest"` to the shim.
- `vi.useFakeTimers()` + `vi.setSystemTime(...)` work: bun mocks the system clock so log file names use the controlled date. The shim's `vi.advanceTimersByTime(ms)` delegates straight to `bun:test.jest.advanceTimersByTime` — since bun >= 1.4.0 that advances the fake clock accumulatively from wherever it is (the old "resets `Date.now()` to real time" bug is fixed). `vi.waitFor` advances the fake clock itself when fake timers are active, matching vitest/testing-library semantics.
- **Known bun 1.4.0 bug**: an `expect(promise).rejects`/`.resolves` registered while fake timers are active hangs when the promise settles from a fake timer. Create the assertion after advancing the clock (see `tests/app/services/edge-tts.test.ts`), or use `accelerateTime()` (manual clock) in tests that settle promises from timers (see `tests/utils/telegram-rate-limit-retry.test.ts`).

### Bun limitations that affect vitest-style tests

- **`vi.mock(path, factory)` only intercepts dynamic imports.** Bun evaluates static `import` statements before any code runs, so `mock.module("node:fs", ...)` called in the test body never applies to a static `import "node:fs"` in the source. Vitest works around this by patching Node's module loader; bun does not. **This fork avoids the issue entirely** by not using `node:fs` (or any other `node:*` module) in the source — all file I/O goes through `Bun.file` / `Bun.write` / `Bun.Glob`, child processes through `Bun.spawn` / `Bun.spawnSync`, crypto through `Bun.CryptoHasher` / `crypto.randomUUID()` (global), HTTP through the global `fetch`, etc. Tests that still mock via `vi.mock("node:fs", ...)` should be migrated to `vi.stubGlobal("Bun", { ... })` or to dynamic `await import()` of the source file.
- **`vi.resetModules()` is a no-op.** Bun has no public module cache reset API. Tests that rely on `resetModules` + `await import(...)` to re-evaluate a module (e.g. `tests/config.test.ts`) will not get a fresh module on the second import. The same source-side refactor (factory function returning a fresh `config` on every call) is the only portable fix.

## STT / voice pipeline (fork addition)

Voice notes flow: Telegram OGG/OPUS → download → `ffmpeg` to 16 kHz mono WAV → `POST {STT_API_URL}/audio/transcriptions` (multipart) → recognized text shown in chat + sent to OpenCode.

- **Local ASR server**: container `llama-asr` (:8080) runs llama.cpp (Vulkan) with Qwen3-ASR-1.7B Q8_0 + mmproj Q8_0. Configured via systemd drop-in `~/.config/systemd/user/opencode-telegram-bot.service.d/stt-local.conf`.
- **Domain glossary** (`STT_DOMAIN_FILE`, optional): JSON file with `hotwords` (sent as the transcription `prompt` field to bias the model) and `corrections` (post-transcription replacements; case-insensitive, word-boundary, accent-tolerant, longest keys first). Reloaded on every transcription — edits don't need a bot restart. Live file: `~/.config/opencode-telegram-bot/stt-domain.json`.
- **Accuracy** (measured 2026-09-17 on an edge-tts mixed es/en test set, key terms scored): 49% without biasing → 86% with hotwords (Qwen3-ASR-1.7B). Whisper large-v3-turbo (legacy `whisper-server.service` on :21000, unused by the bot) was rejected: it translates code-switched speech and hallucinates.
- **Deploy**: the systemd service runs from `/home/ovreuc/opencode-telegram-bot-deploy` (separate checkout pinned to a commit — NOT this dev tree). Update with `git fetch origin && git checkout <sha>` + `systemctl --user restart opencode-telegram-bot.service`.

## CJK guard + auto-correction (fork addition)

The model occasionally answers in Chinese/Japanese/Korean despite language instructions. **The primary fix lives in opencode itself** (global plugin `~/.config/opencode/plugins/cjk-guard.ts`, hook `experimental.text.complete`): it replaces mostly-CJK completed text with a Spanish notice before persisting and prompts the model to rewrite in Spanish at `session.idle` — so the TUI and every other client get the clean version too. The bot-side implementation below is the **delivery layer**: it filters live streaming deltas (which no opencode hook can intercept) and remains as a fallback if the plugin is absent — it stays dormant when the plugin already replaced the text.

1. **Filter (hard guarantee)**: every outgoing Telegram message passes `src/bot/render/cjk-guard.ts`. CJK characters are stripped at the render/construction layers (assistant markdown, reasoning, questions) and the `telegram-text.ts` send/edit/draft helpers rebuild any part that still carries CJK from its sanitized plain projection. Clean messages are untouched (returned by reference).
2. **Auto-correction**: when a completed assistant message is mostly CJK, `cjk-correction-service` (hooked in the `event-subscription-service` completion callback) prompts the same session to rewrite the exact content in Spanish — max 2 attempts per streak, reset by any clean message; the correction prompt is registered as suppressed input so it triggers no notification. The broken message shows `cjk_guard.correcting_notice` and the rewritten reply arrives as a normal message. Attempts exhausted or request failure → `cjk_guard.blocked_notice`. TTS is skipped for replaced messages.

Detection is logged at WARN with the `[CjkGuard]` tag. Added 2026-09-17 after the third language-leak incident (PRs #19/#20). The bot-side layer covers Telegram delivery (live deltas + fallback); completed messages are fixed for every client by the opencode plugin.

## OpenCode SDK quick reference

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

await client.global.health();

await client.project.list();
await client.project.current();

await client.session.list();
await client.session.create({ body: { title: "My session" } });
await client.session.prompt({
  path: { id: "session-id" },
  body: { parts: [{ type: "text", text: "Implement feature X" }] },
});
await client.session.abort({ path: { id: "session-id" } });

const events = await client.event.subscribe();
for await (const event of events.stream) {
  // handle SSE event
}
```

Full docs: https://opencode.ai/docs/sdk

## Workflow

1. Read [PRODUCT.md](./PRODUCT.md) to understand scope and status.
2. Inspect existing code before adding or changing components.
3. Align major architecture changes (including new dependencies) with the user first.
4. Add or update tests for new functionality.
5. After code changes, run quality checks: `bun run check` (runs lint + build + tests).
6. Update checkboxes in [PRODUCT.md](./PRODUCT.md) when relevant tasks are completed.
7. Keep code clean, consistent, and maintainable.
