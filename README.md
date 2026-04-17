# OpenCode Telegram Bot

[![npm version](https://img.shields.io/npm/v/@grinev/opencode-telegram-bot)](https://www.npmjs.com/package/@grinev/opencode-telegram-bot)
[![CI](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Follow updates](https://img.shields.io/badge/-Follow%20updates-333333?logo=x)](https://x.com/grin_rus)

OpenCode Telegram Bot is a secure Telegram client for [OpenCode](https://opencode.ai) CLI that runs on your local machine.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone.

No open ports, no exposed APIs. The bot communicates with your local OpenCode server and the Telegram Bot API only.

Scheduled tasks support. Turns the bot into a lightweight OpenClaw alternative for OpenCode users.

Platforms: macOS, Windows, Linux

Languages: English (`en`), Deutsch (`de`), Español (`es`), Français (`fr`), Русский (`ru`), 简体中文 (`zh`)

<p align="center">
  <img src="assets/screencast.gif" width="45%" alt="OpenCode Telegram Bot screencast" />
</p>

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Live status** — pinned message with current project/worktree, model, context usage, and changed files list, updated in real time
- **Model switching** — pick models from OpenCode favorites and recent history directly in the chat (favorites are shown first)
- **Agent modes** — switch between Plan and Build modes on the fly
- **Subagent activity** — watch live subagent progress in chat, including the current task, agent, model, and active tool step
- **Custom Commands** — run OpenCode custom commands (and built-ins like `init`/`review`) from an inline menu with confirmation
- **Skills Catalog** — browse OpenCode skills from an inline menu and run them immediately or with arguments in the next message
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Voice prompts** — send voice/audio messages, transcribe them via a Whisper-compatible API, and optionally enable spoken replies with `/tts`
- **File attachments** — send images, PDF documents, and any text-based files to OpenCode (code, logs, configs etc.)
- **Scheduled tasks** — schedule prompts to run later or on a recurring interval; see [Scheduled Tasks](#scheduled-tasks)
- **Context control** — compact context when it gets too large, right from the chat
- **Input flow control** — when an interactive flow is active, the bot accepts only relevant input to keep context consistent and avoid accidental actions
- **Git worktree switching** — browse and switch between existing git worktrees for the current repository with `/worktree`
- **Security** — strict user ID whitelist; no one else can access your bot, even if they find it
- **Localization** — UI localization is supported for multiple languages (`BOT_LOCALE`)

Planned features currently in development are listed in [Current Task List](PRODUCT.md#current-task-list).

## Prerequisites

- **Node.js 20+** — [download](https://nodejs.org)
- **OpenCode** — install from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- **Telegram Bot** — you'll create one during setup (takes 1 minute)

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`
2. Follow the prompts to choose a name and username
3. Copy the **bot token** you receive (e.g. `123456:ABC-DEF1234...`)

You'll also need your **Telegram User ID** — send any message to [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID.

### 2. Start OpenCode Server

Run the OpenCode server on the same machine where the bot runs:

```bash
opencode serve
```

> The bot connects to the local OpenCode API at `http://localhost:4096` by default.

> After the bot is configured, you can also start and stop the local OpenCode server from Telegram with `/opencode_start` and `/opencode_stop`.

### 3. Install & Run

The fastest way — run directly with `npx`:

```bash
npx @grinev/opencode-telegram-bot@latest
```

> **Note:** This README tracks the `main` branch, which may include unreleased changes. The latest npm release may not include every feature described here yet. See [recent commits on `main`](https://github.com/grinev/opencode-telegram-bot/commits/main).

> Quick start is for npm usage. You do not need to clone this repository. If you run this command from the source directory (repository root), it may fail with `opencode-telegram: not found`. To run from sources, use the [Development](#development) section.

On first launch, an interactive wizard will guide you through the configuration — it asks for interface language first, then your bot token, user ID, OpenCode API URL, and optional OpenCode server credentials (username/password). After that, you're ready to go. Open your bot in Telegram and start sending tasks.

#### Alternative: Global Install

```bash
npm install -g @grinev/opencode-telegram-bot
opencode-telegram start
```

`start` runs in the foreground by default. This is the recommended mode for `systemd`, Docker, local debugging, and other external process managers.

To run the bot in the built-in background mode instead:

```bash
opencode-telegram start --daemon
opencode-telegram status
opencode-telegram stop
```

> Built-in daemon mode is intended for standalone npm installs without an external supervisor. For `systemd`, `pm2`, or Docker, keep using `opencode-telegram start` without `--daemon`.

For Linux `systemd` setup, see [`docs/LINUX_SYSTEMD_SETUP.md`](./docs/LINUX_SYSTEMD_SETUP.md).

To reconfigure at any time:

```bash
opencode-telegram config
```

## Supported Platforms

| Platform | Status                                       |
| -------- | -------------------------------------------- |
| macOS    | Fully supported                              |
| Windows  | Fully supported                              |
| Linux    | Fully supported (tested on Ubuntu 24.04 LTS) |

## Bot Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/status`         | Server health, current project, session, and model info |
| `/new`            | Create a new session                                    |
| `/abort`          | Abort the current task                                  |
| `/sessions`       | Browse and switch between recent sessions               |
| `/projects`       | Switch between OpenCode projects                        |
| `/worktree`       | Switch between existing git worktrees                   |
| `/open`           | Add a project by browsing directories                   |
| `/tts`            | Toggle audio replies                                    |
| `/rename`         | Rename the current session                              |
| `/commands`       | Browse and run custom commands                          |
| `/skills`         | Browse and run OpenCode skills                          |
| `/task`           | Create a scheduled task                                 |
| `/tasklist`       | Browse and delete scheduled tasks                       |
| `/opencode_start` | Start the local OpenCode server on the bot machine      |
| `/opencode_stop`  | Stop the local OpenCode server on the bot machine       |
| `/help`           | Show available commands                                 |

Any regular text message is sent as a prompt to the coding agent only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured.

When the current project is a git repository, `/worktree` shows the existing worktrees for that repository. Status and pinned updates display the main project path with the active branch, and show a separate `Worktree` line when a linked worktree is selected.

## Scheduled Tasks

Scheduled tasks let you prepare prompts in advance and run them automatically later or on a recurring schedule. This is useful for periodic checks, routine code maintenance, or tasks you want OpenCode to execute while you are away from your computer. Use `/task` to create a scheduled task and `/tasklist` to review or delete existing ones.

- Each task is created from the currently selected OpenCode project and model
- Scheduled executions currently always run with the `build` agent
- Tasks run outside your active chat session, so they do not interrupt or affect the current session flow
- The minimum recurring interval is 5 minutes
- Up to 10 scheduled tasks can exist at once by default; change this with `TASK_LIMIT` in your `.env`

## Configuration

### Localization

- Supported locales: `en`, `de`, `es`, `fr`, `ru`, `zh`
- The setup wizard asks for language first
- You can change locale later with `BOT_LOCALE`

### Environment Variables

When installed via npm, the configuration wizard handles the initial setup. The `.env` file is stored in your platform's app data directory:

- **macOS:** `~/Library/Application Support/opencode-telegram-bot/.env`
- **Windows:** `%APPDATA%\opencode-telegram-bot\.env`
- **Linux:** `~/.config/opencode-telegram-bot/.env`

| Variable                        | Description                                                                                                           | Required | Default                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | :------: | ------------------------ |
| `TELEGRAM_BOT_TOKEN`            | Bot token from @BotFather                                                                                             |   Yes    | —                        |
| `TELEGRAM_ALLOWED_USER_ID`      | Your numeric Telegram user ID                                                                                         |   Yes    | —                        |
| `TELEGRAM_PROXY_URL`            | Proxy URL for Telegram API (SOCKS5/HTTP)                                                                              |    No    | —                        |
| `OPENCODE_API_URL`              | OpenCode server URL                                                                                                   |    No    | `http://localhost:4096`  |
| `OPENCODE_SERVER_USERNAME`      | Server auth username                                                                                                  |    No    | `opencode`               |
| `OPENCODE_SERVER_PASSWORD`      | Server auth password                                                                                                  |    No    | —                        |
| `OPENCODE_MODEL_PROVIDER`       | Default model provider                                                                                                |   Yes    | `opencode`               |
| `OPENCODE_MODEL_ID`             | Default model ID                                                                                                      |   Yes    | `big-pickle`             |
| `BOT_LOCALE`                    | Bot UI language (supported locale code, e.g. `en`, `de`, `es`, `fr`, `ru`, `zh`)                                      |    No    | `en`                     |
| `SESSIONS_LIST_LIMIT`           | Sessions per page in `/sessions`                                                                                      |    No    | `10`                     |
| `PROJECTS_LIST_LIMIT`           | Projects per page in `/projects`                                                                                      |    No    | `10`                     |
| `OPEN_BROWSER_ROOTS`            | Comma-separated paths `/open` is allowed to browse (supports `~`)                                                     |    No    | `~` (home directory)     |
| `COMMANDS_LIST_LIMIT`           | Items per page in `/commands` and `/skills`                                                                           |    No    | `10`                     |
| `TASK_LIMIT`                    | Maximum number of scheduled tasks that can exist at once                                                              |    No    | `10`                     |
| `BASH_TOOL_DISPLAY_MAX_LENGTH`  | Maximum displayed length for `bash` tool commands in Telegram summaries; longer commands are truncated                |    No    | `128`                    |
| `SERVICE_MESSAGES_INTERVAL_SEC` | Service messages interval (thinking + tool calls); keep `>=2` to avoid Telegram rate limits, `0` = immediate          |    No    | `5`                      |
| `HIDE_THINKING_MESSAGES`        | Hide `💭 Thinking...` service messages                                                                                |    No    | `false`                  |
| `HIDE_TOOL_CALL_MESSAGES`       | Hide tool-call service messages (`💻 bash ...`, `📖 read ...`, etc.)                                                  |    No    | `false`                  |
| `HIDE_TOOL_FILE_MESSAGES`       | Hide file edit documents sent as `.txt` attachments (`edit_*.txt`, `write_*.txt`)                                     |    No    | `false`                  |
| `RESPONSE_STREAMING`            | Stream assistant replies while they are generated across one or more Telegram messages                                |    No    | `true`                   |
| `MESSAGE_FORMAT_MODE`           | Assistant reply formatting mode: `markdown` (Telegram MarkdownV2) or `raw`                                            |    No    | `markdown`               |
| `CODE_FILE_MAX_SIZE_KB`         | Max file size (KB) to send as document                                                                                |    No    | `100`                    |
| `STT_API_URL`                   | Whisper-compatible API base URL (enables voice/audio transcription)                                                   |    No    | —                        |
| `STT_API_KEY`                   | API key for your STT provider                                                                                         |    No    | —                        |
| `STT_MODEL`                     | STT model name passed to `/audio/transcriptions`                                                                      |    No    | `whisper-large-v3-turbo` |
| `STT_LANGUAGE`                  | Optional language hint (empty = provider auto-detect)                                                                 |    No    | —                        |
| `STT_NOTE_PROMPT`               | Optional note prepended to the LLM prompt as `[Note: ...]` for voice transcriptions; empty / `false` / `0` disable it |    No    | —                        |
| `TTS_API_URL`                   | TTS API base URL                                                                                                      |    No    | —                        |
| `TTS_API_KEY`                   | TTS API key                                                                                                           |    No    | —                        |
| `TTS_MODEL`                     | TTS model name passed to `/audio/speech`                                                                              |    No    | `gpt-4o-mini-tts`        |
| `TTS_VOICE`                     | OpenAI-compatible TTS voice name                                                                                      |    No    | `alloy`                  |
| `LOG_LEVEL`                     | Log level (`debug`, `info`, `warn`, `error`)                                                                          |    No    | `info`                   |
| `LOG_RETENTION`                 | Number of log files to keep: launch files in `sources`, daily files in `installed`                                    |    No    | `10`                     |

> **Keep your `.env` file private.** It contains your bot token. Never commit it to version control.

Logs are written to `./logs` when running from sources and to the runtime config directory `logs/` folder in `installed` mode. Log rotation depends on runtime mode: `sources` creates one file per bot launch, while `installed` appends to one file per day. Old log files are removed according to `LOG_RETENTION`.

### Voice and Audio Transcription (Optional)

If `STT_API_URL` and `STT_API_KEY` are set, the bot will:

1. Accept `voice` and `audio` Telegram messages
2. Transcribe them via `POST {STT_API_URL}/audio/transcriptions`
3. Show recognized text in chat
4. Send the recognized text to OpenCode as a normal prompt

If `STT_NOTE_PROMPT` is set to a non-empty value other than `false` or `0`, the bot prepends `[Note: ...]` to the transcription before sending it to the LLM. The recognized text shown in Telegram stays unchanged.

If TTS credentials are configured, you can toggle spoken replies globally with `/tts`. The preference is stored in `settings.json` and persists across restarts.

TTS configuration example:

```env
TTS_API_URL=https://api.openai.com/v1
TTS_API_KEY=your-tts-api-key
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
```

Supported provider examples (Whisper-compatible):

- **OpenAI**
  - `STT_API_URL=https://api.openai.com/v1`
  - `STT_MODEL=whisper-1`
- **Groq**
  - `STT_API_URL=https://api.groq.com/openai/v1`
  - `STT_MODEL=whisper-large-v3-turbo`
- **Together**
  - `STT_API_URL=https://api.together.xyz/v1`
  - `STT_MODEL=openai/whisper-large-v3`

If STT variables are not set, voice/audio transcription is disabled and the bot will ask you to configure STT.

### Model Configuration

The model picker uses OpenCode local model state (`favorite` + `recent`):

- Favorites are shown first, then recent
- Models already in favorites are not duplicated in recent
- Current model is marked with `✅`
- Default model from `OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID` is always included in favorites

To add a model to favorites, open OpenCode TUI (`opencode`), go to model selection, and press **Cmd+F/Ctrl+F** on the model.

## Security

The bot enforces a strict **user ID whitelist**. Only the Telegram user whose numeric ID matches `TELEGRAM_ALLOWED_USER_ID` can interact with the bot. Messages from any other user are silently ignored and logged as unauthorized access attempts.

Since the bot runs locally on your machine and connects to your local OpenCode server, there is no external attack surface beyond the Telegram Bot API itself.

## Development

### Running from Source

```bash
git clone https://github.com/grinev/opencode-telegram-bot.git
cd opencode-telegram-bot
npm install
cp .env.example .env
# Edit .env with your bot token, user ID, and model settings
```

Build and run:

```bash
npm run dev
```

### Available Scripts

| Script                          | Description                          |
| ------------------------------- | ------------------------------------ |
| `npm run dev`                   | Build and start (development)        |
| `npm run build`                 | Compile TypeScript                   |
| `npm start`                     | Run compiled code                    |
| `npm run release:notes:preview` | Preview auto-generated release notes |
| `npm run lint`                  | ESLint check (zero warnings policy)  |
| `npm run format`                | Format code with Prettier            |
| `npm test`                      | Run tests (Vitest)                   |
| `npm run test:coverage`         | Tests with coverage report           |

> **Note:** No file watcher or auto-restart is used. The bot maintains persistent SSE and long-polling connections — automatic restarts would break them mid-task. After making changes, restart manually with `npm run dev`.

## Troubleshooting

**Bot doesn't respond to messages**

- Make sure `TELEGRAM_ALLOWED_USER_ID` matches your actual Telegram user ID (check with [@userinfobot](https://t.me/userinfobot))
- Verify the bot token is correct

**"OpenCode server is not available"**

- Ensure an OpenCode server is running at the configured `OPENCODE_API_URL` (default: `http://localhost:4096`)
- For a local setup, you can start it with `opencode serve` or use `/opencode_start` in Telegram
- If `OPENCODE_API_URL` points to a remote server, verify that the address is reachable from the bot machine and that the remote server is healthy

**No models in model picker**

- Add models to your OpenCode favorites: open OpenCode TUI, go to model selection, press **Ctrl+F** on desired models
- Verify `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` point to an available model in your setup

**Linux: permission denied errors**

- Make sure the CLI binary has execute permission: `chmod +x $(which opencode-telegram)`
- Check that the config directory is writable: `~/.config/opencode-telegram-bot/`

## Contributing

Please follow commit and release note conventions in [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

Have questions, want to share your experience using the bot, or have an idea for a feature? Join the conversation in [GitHub Discussions](https://github.com/grinev/opencode-telegram-bot/discussions).

## License

[MIT](LICENSE) © Ruslan Grinev
