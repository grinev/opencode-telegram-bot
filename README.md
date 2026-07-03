# OpenCode Telegram Bot

[![npm version](https://img.shields.io/npm/v/@grinev/opencode-telegram-bot)](https://www.npmjs.com/package/@grinev/opencode-telegram-bot)
[![CI](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Follow updates](https://img.shields.io/badge/-Follow%20updates-333333?logo=x)](https://x.com/grin_rus)
[![Community](https://img.shields.io/badge/Community-Telegram-26A5E4?logo=telegram&logoColor=white)](https://t.me/+Fj_IyKRi6-41MGUy)

OpenCode Telegram Bot is a secure Telegram client for [OpenCode](https://opencode.ai) CLI that runs on your local machine.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone.

No open ports, no exposed APIs. The bot communicates with your local OpenCode server and the Telegram Bot API only.

Scheduled tasks support. Turns the bot into a lightweight OpenClaw alternative for OpenCode users.

Platforms: macOS, Windows, Linux

Languages: English (`en`), العربية (`ar`), Deutsch (`de`), Español (`es`), Français (`fr`), Русский (`ru`), 简体中文 (`zh`)

<p align="center">
  <img src="assets/screencast.gif" width="45%" alt="OpenCode Telegram Bot screencast" />
</p>

> I use [boardown](https://github.com/grinev/boardown), my open-source Markdown-based task board, to plan and track this project. It stores tasks in plain `.md` files and can be used as a VS Code extension or a desktop app.

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Track live session** — follow a live OpenCode CLI session; see [Track Existing Session](#track-existing-session)
- **Background session notifications** — get short notifications when detached or non-current sessions in the current project/worktree reply, ask questions, or request permissions
- **Live status** — pinned message with current project/worktree, model, context usage, and changed files list, updated in real time
- **Model switching** — pick models from OpenCode favorites and recent history directly in the chat (favorites are shown first)
- **Agent modes** — switch between Plan and Build modes on the fly
- **Subagent activity** — watch live subagent progress in chat, including the current task, agent, model, and active tool step
- **Custom Commands** — run OpenCode custom commands (and built-ins like `init`/`review`) from an inline menu with confirmation
- **Skills Catalog** — browse OpenCode skills from an inline menu and run them immediately or with arguments in the next message
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Runtime settings** — use `/settings` to change runtime preferences; see [Runtime Settings](#runtime-settings)
- **Voice prompts** — send voice/audio messages, transcribe them via a Whisper-compatible API, and optionally enable spoken replies in `/settings`
- **File attachments** — send images, PDF documents, and text-based files to OpenCode, including multiple files in one Telegram album
- **Scheduled tasks** — schedule prompts to run later or on a recurring interval; see [Scheduled Tasks](#scheduled-tasks)
- **Context control** — compact context when it gets too large, right from the chat
- **Input flow control** — when an interactive flow is active, the bot accepts only relevant input to keep context consistent and avoid accidental actions
- **Git worktree switching** — browse and switch between existing git worktrees for the current repository with `/worktree`
- **Security** — strict user ID whitelist; no one else can access your bot, even if they find it
- **Localization** — UI localization is supported for multiple languages (`BOT_LOCALE`)
- **Interactive file browser** — use `/ls` to browse files and directories inside the current project, open subdirectories, go back, and download files by tapping them

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
| `/detach`         | Detach from the current session without stopping it     |
| `/sessions`       | Browse and switch between recent sessions               |
| `/messages`       | Browse user messages, revert or fork from a previous state     |
| `/projects`       | Switch between OpenCode projects                        |
| `/worktree`       | Switch between existing git worktrees                   |
| `/open`           | Add a project by browsing directories                   |
| `/ls`             | List directory contents, then tap to open or download   |
| `/settings`       | Change bot settings                                     |
| `/rename`         | Rename the current session                              |
| `/commands`       | Browse and run custom commands                          |
| `/skills`         | Browse and run OpenCode skills                          |
| `/mcps`           | Browse and toggle MCP servers                           |
| `/task`           | Create a scheduled task                                 |
| `/tasklist`       | Browse and delete scheduled tasks                       |
| `/opencode_start` | Start the local OpenCode server on the bot machine      |
| `/opencode_stop`  | Stop the local OpenCode server on the bot machine       |
| `/help`           | Show available commands                                 |

Any regular text message is sent as a prompt to the coding agent only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured.

When the current project is a git repository, `/worktree` shows the existing worktrees for that repository. Status and pinned updates display the main project path with the active branch, and show a separate `Worktree` line when a linked worktree is selected.

## Message History, Revert, and Fork

The `/messages` command displays all user messages in the current session, sorted by time (newest first). Select a message to view its full text and access the **Revert** and **Fork** actions.

**Revert** rolls back the session state to the selected message, discarding all subsequent messages and agent responses. This is useful when you want to retry a different approach from a specific point in the conversation.

**Fork** creates a new session that branches from the selected message. The original session remains unchanged, and you can continue working in the new forked session. This is useful when you want to explore an alternative approach without losing the original conversation history.

## Scheduled Tasks

Scheduled tasks let you prepare prompts in advance and run them automatically later or on a recurring schedule. This is useful for periodic checks, routine code maintenance, or tasks you want OpenCode to execute while you are away from your computer. Use `/task` to create a scheduled task and `/tasklist` to review or delete existing ones.

- Each task is created from the currently selected OpenCode project and model
- Scheduled executions currently always run with the `build` agent
- Tasks run outside your active chat session, so they do not interrupt or affect the current session flow
- The minimum recurring interval is 5 minutes
- If a recurring task is still running when its next interval arrives, the bot does not start a parallel copy of the same task and does not replay missed intervals later
- By default, the bot waits up to 120 minutes for one scheduled task run; change this with `SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES` if needed
- Up to 10 scheduled tasks can exist at once by default; change this with `TASK_LIMIT` in your `.env`

## Track Existing Session

After you create a new session, select an existing one, or let the bot auto-create one from your first prompt, the bot automatically starts tracking that session. It follows live events from the same OpenCode CLI session, shows external text input sent from another TUI client, and lets you continue the same session from Telegram.

For this to work, the console OpenCode instance must be started on the same port the bot connects to. By default, OpenCode starts on a random port, so use one of the setups below.

- **Single TUI, simplest setup** — start OpenCode on a fixed port: `opencode --port 4096`
- Point the bot to `http://127.0.0.1:4096`, then select or create the same session in Telegram
- **Multiple TUI clients, shared backend** — start one backend: `opencode serve --port 4096`
- In each terminal client, connect with: `opencode attach http://127.0.0.1:4096`
- In the bot, select or create the same session to start tracking it automatically

## Configuration

### Localization

- Supported locales: `en`, `ar`, `de`, `es`, `fr`, `ru`, `zh`
- The setup wizard asks for language first
- You can change locale later with `BOT_LOCALE`

### Environment Variables

When installed via npm, the configuration wizard handles the initial setup. The `.env` file is stored in your platform's app data directory:

- **macOS:** `~/Library/Application Support/opencode-telegram-bot/.env`
- **Windows:** `%APPDATA%\opencode-telegram-bot\.env`
- **Linux:** `~/.config/opencode-telegram-bot/.env`

| Variable                                   | Description                                                                                                           | Required | Default                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | :------: | ------------------------ |
| `TELEGRAM_BOT_TOKEN`                       | Bot token from @BotFather                                                                                             |   Yes    | —                        |
| `TELEGRAM_ALLOWED_USER_ID`                 | Your numeric Telegram user ID                                                                                         |   Yes    | —                        |
| `TELEGRAM_PROXY_URL`                       | Proxy URL for Telegram API (SOCKS5/HTTP)                                                                              |    No    | —                        |
| `TELEGRAM_API_ROOT`                        | Custom Telegram Bot API root URL (e.g. nginx reverse-proxying `api.telegram.org`); applied to API calls and file downloads | No | `https://api.telegram.org` |
| `TELEGRAM_PROXY_SECRET`                    | Shared secret sent as `X-Proxy-Secret` header on every Bot API request and file download (used with `TELEGRAM_API_ROOT`) | No | —                        |
| `TELEGRAM_FORCE_IPV4`                      | Force IPv4 for direct Telegram API and file requests; useful when IPv6 DNS works but outbound IPv6 is broken           |    No    | `false`                  |
| `OPENCODE_API_URL`                         | OpenCode server URL                                                                                                   |    No    | `http://localhost:4096`  |
| `OPENCODE_AUTO_RESTART_ENABLED`            | Automatically restart a local OpenCode server when health-checks fail                                                 |    No    | `false`                  |
| `OPENCODE_MONITOR_INTERVAL_SEC`            | Health monitor interval in seconds when OpenCode auto-restart is enabled                                              |    No    | `300`                    |
| `OPENCODE_SERVER_USERNAME`                 | Server auth username                                                                                                  |    No    | `opencode`               |
| `OPENCODE_SERVER_PASSWORD`                 | Server auth password                                                                                                  |    No    | —                        |
| `OPENCODE_MODEL_PROVIDER`                  | Default model provider                                                                                                |   Yes    | `opencode`               |
| `OPENCODE_MODEL_ID`                        | Default model ID                                                                                                      |   Yes    | `big-pickle`             |
| `BOT_LOCALE`                               | Bot UI language (supported locale code, e.g. `en`, `ar`, `de`, `es`, `fr`, `ru`, `zh`)                                |    No    | `en`                     |
| `SESSIONS_LIST_LIMIT`                      | Sessions per page in `/sessions`                                                                                      |    No    | `10`                     |
| `MESSAGES_LIST_LIMIT`                      | User messages per page in `/messages`                                                                                 |    No    | `10`                     |
| `PROJECTS_LIST_LIMIT`                      | Projects per page in `/projects`                                                                                      |    No    | `10`                     |
| `OPEN_BROWSER_ROOTS`                       | Comma-separated paths `/open` is allowed to browse (supports `~`)                                                     |    No    | `~` (home directory)     |
| `COMMANDS_LIST_LIMIT`                      | Items per page in `/commands` and `/skills`                                                                           |    No    | `10`                     |
| `TASK_LIMIT`                               | Maximum number of scheduled tasks that can exist at once                                                              |    No    | `10`                     |
| `SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES` | Maximum time the bot waits for one scheduled task run before marking it failed                                        |    No    | `120`                    |
| `SCHEDULED_TASK_DISABLE_NOTIFICATION`      | Send scheduled task result/error messages without Telegram push notifications                                         |    No    | `false`                  |
| `BASH_TOOL_DISPLAY_MAX_LENGTH`             | Maximum displayed length for `bash` tool commands in Telegram summaries; longer commands are truncated                |    No    | `128`                    |
| `TRACK_BACKGROUND_SESSIONS`                | Track detached/non-current sessions in the current selected project/worktree and send short notifications             |    No    | `true`                   |
| `RESPONSE_STREAM_THROTTLE_MS`              | Stream update throttle in milliseconds for assistant, thinking, and tool message edits                                |    No    | `1000`                   |
| `MESSAGE_FORMAT_MODE`                      | Assistant reply formatting mode: `markdown` (Telegram MarkdownV2) or `raw`                                            |    No    | `markdown`               |
| `INITIAL_SETTINGS_PRESET`                  | JSON object that seeds default `/settings` values on first run (keys not yet persisted); see [Runtime Settings](#runtime-settings) |    No    | `{}`                     |
| `CODE_FILE_MAX_SIZE_KB`                    | Max file size (KB) to send as document                                                                                |    No    | `100`                    |
| `STT_API_URL`                              | Whisper-compatible API base URL (enables voice/audio transcription)                                                   |    No    | —                        |
| `STT_API_KEY`                              | API key for your STT provider                                                                                         |    No    | —                        |
| `STT_MODEL`                                | STT model name passed to `/audio/transcriptions`                                                                      |    No    | `whisper-large-v3-turbo` |
| `STT_LANGUAGE`                             | Optional language hint (empty = provider auto-detect)                                                                 |    No    | —                        |
| `STT_NOTE_PROMPT`                          | Optional note prepended to the LLM prompt as `[Note: ...]` for voice transcriptions; empty / `false` / `0` disable it |    No    | —                        |
| `TTS_PROVIDER`                             | TTS provider: `openai` for OpenAI-compatible APIs, `elevenlabs` for ElevenLabs, or `google` for Google Cloud TTS      |    No    | `openai`                 |
| `TTS_API_URL`                              | TTS API base URL for OpenAI-compatible APIs or ElevenLabs                                                             |    No    | —                        |
| `TTS_API_KEY`                              | TTS API key for OpenAI-compatible APIs or ElevenLabs                                                                  |    No    | —                        |
| `TTS_MODEL`                                | TTS model name. Passed as `model` for OpenAI-compatible APIs and `model_id` for ElevenLabs                            |    No    | `gpt-4o-mini-tts`        |
| `TTS_VOICE`                                | TTS voice name or ElevenLabs voice ID. Defaults to `alloy`, `21m00Tcm4TlvDq8ikWAM`, or `en-US-Studio-O` by provider   |    No    | provider-specific        |
| `GOOGLE_APPLICATION_CREDENTIALS`           | Path to a Google Cloud service account JSON key file for `TTS_PROVIDER=google`                                        |    No    | —                        |
| `LOG_LEVEL`                                | Log level (`debug`, `info`, `warn`, `error`)                                                                          |    No    | `info`                   |
| `LOG_RETENTION`                            | Number of log files to keep: launch files in `sources`, daily files in `installed`                                    |    No    | `10`                     |

> **Keep your `.env` file private.** It contains your bot token. Never commit it to version control.

Logs are written to `./logs` when running from sources and to the runtime config directory `logs/` folder in `installed` mode. Log rotation depends on runtime mode: `sources` creates one file per bot launch, while `installed` appends to one file per day. Old log files are removed according to `LOG_RETENTION`.

### Runtime Settings

Runtime preferences are changed from `/settings` and stored in `settings.json`:

- Compact output mode
- Thinking content display
- Assistant run footer display
- Diff file attachments
- Response streaming mode: `edit` or `draft (experimental)`; applies only to final assistant replies, not thinking messages
- Audio replies: `off`, `all`, or `auto` when TTS is configured

You can seed the initial defaults for any of these settings without hard-coding them in your Docker image by setting `INITIAL_SETTINGS_PRESET` to a JSON object. Only keys not yet persisted in `settings.json` are affected — settings the user has already changed via `/settings` are left untouched:

```env
INITIAL_SETTINGS_PRESET={"showAssistantRunFooter":false,"compactOutputMode":true,"ttsMode":"auto"}
```

### Reverse Proxy (Optional)

For environments that block `api.telegram.org` but allow your own HTTPS endpoint (corporate networks, restricted regions), you can route Bot API traffic through a reverse proxy you control. This is an alternative to the SOCKS/HTTP forward proxy configured with `TELEGRAM_PROXY_URL`.

Set `TELEGRAM_API_ROOT` to your reverse-proxy URL — both Bot API calls and file downloads (including voice/audio files) will use it. Optionally set `TELEGRAM_PROXY_SECRET` so the bot sends an `X-Proxy-Secret` header your proxy can use to authorize callers.

`.env`:

```env
TELEGRAM_API_ROOT=https://tg-proxy.yourdomain.com
TELEGRAM_PROXY_SECRET=some-long-random-string
```

Example nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name tg-proxy.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/tg-proxy.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tg-proxy.yourdomain.com/privkey.pem;

    access_log off;  # the bot token appears in URL paths
    client_max_body_size 50m;

    if ($http_x_proxy_secret != "some-long-random-string") { return 403; }

    location / {
        proxy_pass https://api.telegram.org;
        proxy_ssl_server_name on;
        proxy_set_header Host api.telegram.org;
    }
}
```

`TELEGRAM_API_ROOT` and `TELEGRAM_PROXY_URL` are alternative connectivity modes — the former picks the URL the bot connects to (a reverse proxy on your side), while the latter tunnels TCP through a forward proxy. Configure only one of them; the bot rejects using both at startup.

### Force IPv4 for Telegram (Optional)

If the bot fails during startup with errors such as `Network request for 'setMyCommands' failed` or `Network request for 'getWebhookInfo' failed`, and the same machine has broken outbound IPv6 connectivity, force direct Telegram requests to use IPv4:

```env
TELEGRAM_FORCE_IPV4=true
```

This affects direct Bot API calls and Telegram file downloads. It is not a replacement for `TELEGRAM_PROXY_URL` or `TELEGRAM_API_ROOT` when Telegram is blocked by the network.

### Voice and Audio Transcription (Optional)

If `STT_API_URL` and `STT_API_KEY` are set, the bot will:

1. Accept `voice` and `audio` Telegram messages
2. Transcribe them via `POST {STT_API_URL}/audio/transcriptions`
3. Show recognized text in chat
4. Send the recognized text to OpenCode as a normal prompt

If `STT_NOTE_PROMPT` is set to a non-empty value other than `false` or `0`, the bot prepends `[Note: ...]` to the transcription before sending it to the LLM. The recognized text shown in Telegram stays unchanged.

If TTS credentials are configured, you can choose spoken reply behavior in `/settings`: `off` disables audio replies, `all` sends audio for every assistant reply, and `auto` sends audio only after voice/audio prompts. The preference is stored in `settings.json` and persists across restarts.

OpenAI-compatible TTS configuration example:

```env
TTS_PROVIDER=openai
TTS_API_URL=https://api.openai.com/v1
TTS_API_KEY=your-tts-api-key
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
```

ElevenLabs TTS configuration example:

```env
TTS_PROVIDER=elevenlabs
TTS_API_URL=https://api.elevenlabs.io/v1
TTS_API_KEY=your-elevenlabs-api-key
TTS_MODEL=eleven_flash_v2_5
TTS_VOICE=21m00Tcm4TlvDq8ikWAM
```

Google Cloud TTS configuration example:

```env
TTS_PROVIDER=google
TTS_VOICE=en-US-Studio-O
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
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
- For VPS/systemd setups with scheduled tasks, enable `OPENCODE_AUTO_RESTART_ENABLED=true` to let the bot restart a local OpenCode server when health-checks fail
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

Have questions, want to share your experience using the bot, or have an idea for a feature? Join the [Telegram group](https://t.me/+Fj_IyKRi6-41MGUy) for announcements and discussions, or start a thread in [GitHub Discussions](https://github.com/grinev/opencode-telegram-bot/discussions).

## License

[MIT](LICENSE) © Ruslan Grinev
