# AGENTS.md

Instructions for AI agents working on this project.

## About the project

**opencode-telegram-bot** is a Telegram bot that acts as a mobile client for OpenCode.
It lets a user run and monitor coding tasks on a local machine through Telegram.

Functional requirements, features, and development status are in [PRODUCT.md](./PRODUCT.md).

## Technology stack

- **Language:** TypeScript 5.x
- **Runtime:** Node.js 20+
- **Package manager:** npm
- **Configuration:** environment variables (`.env`)
- **Logging:** custom logger with levels (`debug`, `info`, `warn`, `error`)

### Core dependencies

- `grammy` - Telegram Bot API framework (https://grammy.dev/)
- `@grammyjs/menu` - inline keyboards and menus
- `@opencode-ai/sdk` - official OpenCode Server SDK
- `dotenv` - environment variable loading

### Test dependencies

- Vitest
- Mocks/stubs via `vi.mock()`

### Code quality

- ESLint + Prettier
- TypeScript strict mode

## Project structure

```text
opencode-telegram-bot/
|- src/
|  |- index.ts                 # Source-mode entry point
|  |- cli.ts                   # Installed CLI entry point
|  |- config.ts                # Environment config loader
|  |- app/
|  |  \- start-bot-app.ts      # App bootstrap
|  |- runtime/
|  |  |- mode.ts               # Runtime mode resolution
|  |  |- paths.ts              # Runtime-aware paths
|  |  \- bootstrap.ts          # CLI bootstrap/config wizard
|  |- bot/
|  |  |- index.ts              # Bot initialization and handlers
|  |  |- commands/             # Command handlers
|  |  |  \- definitions.ts     # Centralized command list
|  |  |- handlers/             # Callback handlers (question/permission/model/etc.)
|  |  |- middleware/
|  |  |  \- auth.ts            # User authorization
|  |  \- utils/
|  |     \- keyboard.ts        # Keyboard builders/helpers
|  |- opencode/
|  |  |- client.ts             # SDK wrapper
|  |  \- events.ts             # SSE subscription and event handling
|  |- session/manager.ts       # Current session state
|  |- project/manager.ts       # Project management
|  |- settings/manager.ts      # settings.json load/save
|  |- summary/
|  |  |- aggregator.ts         # Event aggregation
|  |  \- formatter.ts          # Telegram formatting
|  |- question/manager.ts      # Question tool state
|  |- permission/manager.ts    # Permission tool state
|  |- model/manager.ts         # Model selection state
|  |- agent/manager.ts         # Agent mode state
|  |- variant/manager.ts       # Variant selection state
|  |- keyboard/manager.ts      # Bottom keyboard state
|  |- pinned/manager.ts        # Pinned status message state
|  |- process/manager.ts       # OpenCode process lifecycle
|  |- i18n/                    # Localized strings (en, ru)
|  \- utils/
|     |- logger.ts             # Logging utility
|     \- safe-background-task.ts
|- tests/
|- scripts/
|- package.json
|- PRODUCT.md
|- README.md
|- AGENTS.md
```

## Architecture

### Main components

1. **Bot Layer** - grammY setup, middleware, commands, callback handlers
2. **OpenCode Client Layer** - SDK wrapper and SSE event subscription
3. **State Managers** - session/project/settings/question/permission/model/agent/variant/keyboard/pinned
4. **Summary Pipeline** - event aggregation and Telegram-friendly formatting
5. **Process Manager** - local OpenCode server process start/stop/status
6. **Runtime/CLI Layer** - runtime mode, config bootstrap, CLI commands
7. **I18n Layer** - localized bot and CLI strings (`en`, `ru`)

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

### Git

- **Commits:** Never create commits automatically. Commit only when the user explicitly asks.

### Windows / PowerShell

- Keep in mind the runtime environment is Windows.
- Avoid fragile one-liners that can break in PowerShell.
- Use absolute paths when working with file tools (`read`, `write`, `edit`).

## Coding rules

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
  { command: "stop", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "model", descriptionKey: "cmd.description.model" },
  { command: "agent", descriptionKey: "cmd.description.agent" },
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
- Use `vi.mock()` for external dependencies

## Configuration

### Environment variables (`.env`)

```bash
# Telegram (required)
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_ALLOWED_USER_ID=123456789

# OpenCode API (optional)
# OPENCODE_API_URL=http://localhost:4096

# OpenCode Server auth (optional)
# OPENCODE_SERVER_USERNAME=opencode
# OPENCODE_SERVER_PASSWORD=

# Default model (required)
OPENCODE_MODEL_PROVIDER=opencode
OPENCODE_MODEL_ID=big-pickle

# Logging (optional)
# LOG_LEVEL=info  # debug, info, warn, error

# Bot options (optional)
# SESSIONS_LIST_LIMIT=10
# BOT_LOCALE=en    # en or ru

# File output options (optional)
# CODE_FILE_MAX_SIZE_KB=100
```

### Environment variables reference

| Variable                   | Description                       | Required | Default                 |
| -------------------------- | --------------------------------- | -------- | ----------------------- |
| `TELEGRAM_BOT_TOKEN`       | Bot token from @BotFather         | Yes      | -                       |
| `TELEGRAM_ALLOWED_USER_ID` | Allowed Telegram user ID          | Yes      | -                       |
| `TELEGRAM_PROXY_URL`       | Proxy URL for Telegram API        | No       | -                       |
| `OPENCODE_MODEL_PROVIDER`  | Default model provider            | Yes      | -                       |
| `OPENCODE_MODEL_ID`        | Default model ID                  | Yes      | -                       |
| `OPENCODE_API_URL`         | OpenCode API URL                  | No       | `http://localhost:4096` |
| `OPENCODE_SERVER_USERNAME` | OpenCode auth username            | No       | `opencode`              |
| `OPENCODE_SERVER_PASSWORD` | OpenCode auth password            | No       | empty                   |
| `LOG_LEVEL`                | Logging level                     | No       | `info`                  |
| `SESSIONS_LIST_LIMIT`      | Max sessions shown in `/sessions` | No       | `10`                    |
| `BOT_LOCALE`               | Bot locale (`en` or `ru`)         | No       | `en`                    |
| `CODE_FILE_MAX_SIZE_KB`    | Max code file size to send        | No       | `100`                   |

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
5. After code changes, run quality checks: `npm run build`, `npm run lint`, and `npm test`.
6. Update checkboxes in `PRODUCT.md` when relevant tasks are completed.
7. Keep code clean, consistent, and maintainable.
