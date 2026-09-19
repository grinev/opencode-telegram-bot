# OpenCode Telegram Bot (Bun port)

[![CI](https://github.com/primigenum/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/primigenum/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.4.0-f9f1e1)](https://bun.sh)

OpenCode Telegram Bot is a secure Telegram client for [OpenCode](https://opencode.ai) CLI that runs on your local machine. This is a **Bun port of [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)** — same feature set, same UX, but no `npm` and no `node` in the toolchain.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone.

No open ports, no exposed APIs. The bot communicates with your local OpenCode server and the Telegram Bot API only.

Scheduled tasks support. Turns the bot into a lightweight OpenClaw alternative for OpenCode users.

Platforms: macOS, Windows, Linux

## What changed vs. the upstream Node port

Languages: English (`en`), العربية (`ar`), Deutsch (`de`), Español (`es`), Français (`fr`), Italiano (`it`), 한국어 (`ko`), Português (Brasil) (`pt`), Русский (`ru`), 简体中文 (`zh`)

- **Runtime**: Node.js 20+ → **Bun ≥ 1.4.0** (`bun run` everywhere; the bin entry is `#!/usr/bin/env bun`)
- **Package manager**: npm → **bun install** (no `package-lock.json`, just `bun.lock`)
- **Test runner**: vitest → **bun test** (with a thin vitest-compatible shim — see [Test status](#test-status))
- **SQLite driver**: `better-sqlite3` (native node addon) → **`bun:sqlite`** (built-in to Bun, no compile)
- **CI**: `setup-node` → **`oven-sh/setup-bun`**
- **Distribution**: removed npm publish workflow (this fork is for personal use; re-add a publish workflow if you decide to ship to npm later)

Everything else is identical. Same commands, same Telegram UX, same `.env` schema, same config wizard.

> Looking for the full port story — runtime details, the shim, bun limitations, the `node:*` → `bun:*` mapping table, and industry research? See **[`docs/BUN_PORT.md`](./docs/BUN_PORT.md)** (the canonical reference for the port).

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Track live session** — follow a live OpenCode CLI session
- **Background session notifications** — get short notifications when detached or non-current sessions reply
- **Live status** — pinned message with current project/worktree, model, context usage, and changed files list, updated in real time
- **Model switching** — pick models from OpenCode favorites and recent history directly in the chat (favorites are shown first), or browse all models by provider
- **Agent modes** — switch between Plan and Build modes on the fly
- **Subagent activity** — watch live subagent progress in chat, including the current task, agent, model (with variant when set), and active tool step
- **Custom Commands** — run OpenCode custom commands (and built-ins like `init`/`review`) from an inline menu with confirmation
- **Skills Catalog** — browse OpenCode skills from an inline menu and run them immediately or with arguments in the next message
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Runtime settings** — use `/settings` to change runtime preferences; see [Runtime Settings](#runtime-settings)
- **Voice prompts** — send voice/audio messages, transcribe them via a Whisper-compatible API, and optionally enable spoken replies in `/settings`
- **File attachments** — send images, PDF documents, and text-based files to OpenCode, including multiple files in one Telegram album
- **Scheduled tasks** — schedule prompts to run later or on a recurring interval; see [Scheduled Tasks](#scheduled-tasks)
- **Message queue** — enable in `/settings` to hold messages sent while the agent is busy, send them one by one afterwards, and manage them from the bottom keyboard
- **Context control** — compact context when it gets too large, right from the chat
- **Input flow control** — when an interactive flow is active, the bot accepts only relevant input to keep context consistent and avoid accidental actions
- **Git worktree switching** — browse and switch between existing git worktrees for the current repository with `/worktree`
- **Security** — strict user ID whitelist; no one else can access your bot, even if they find it
- **Localization** — UI localization is supported for multiple languages (`BOT_LOCALE`)
- **Docker support** — run the bot as a container while OpenCode stays on the host; see [Docker Deployment](#docker-deployment)
- **Interactive file browser** — use `/ls` to browse files and directories inside the current project, open subdirectories, go back, and download files by tapping them
- **Attach a file to your next prompt** — tap **📎 Attach to next prompt** on a text file in `/ls`, and it is sent to OpenCode together with your next message, once

Planned features currently in development are listed in [Current Task List](PRODUCT.md#current-task-list).

## Prerequisites

- **Bun ≥ 1.4.0** — [install](https://bun.sh)
- **OpenCode** — install from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- **Telegram Bot** — you'll create one during setup (takes 1 minute)

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`
2. Follow the prompts to choose a name and username
3. Copy the **bot token** you receive (e.g. `123456:ABC-DEF1234...`)

You'll also need your **Telegram User ID** — send any message to [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID.

### 2. Start OpenCode Server

```bash
opencode serve
```

The bot connects to `http://localhost:4096` by default.

### 3. Install & Run

```bash
git clone https://github.com/primigenum/opencode-telegram-bot.git
cd opencode-telegram-bot
bun install
cp .env.example .env
# Edit .env with your bot token, user ID, and model settings

bun run dev
```

`bun run dev` uses `bun --hot` for hot reload — edit any file under `src/` and the bot restarts in <1s.

#### Alternative: Foreground start

```bash
bun run start:foreground
```

Same as `bun run dev` but without the file watcher (cleaner for `systemd`, Docker, etc.).

On first launch, an interactive wizard guides you through configuration (interface language → bot token → user ID → OpenCode API URL → optional server credentials). After that, the bot is ready in Telegram.

#### Alternative: Built-in daemon mode

The CLI supports a built-in `start --daemon` mode for standalone runs without a process manager:

```bash
bun run dist/cli.js start --daemon   # uses the built binary
bun run dist/cli.js status
bun run dist/cli.js stop
```

> Daemon mode is intended for standalone installs without an external supervisor. For `systemd`, `pm2`, or Docker, use the foreground command.

To reconfigure at any time:

```bash
bun run dist/cli.js config
```

## Supported Platforms

| Platform | Status                                       |
| -------- | -------------------------------------------- |
| macOS    | Fully supported                              |
| Windows  | Fully supported                              |
| Linux    | Fully supported (tested on Fedora 44, Bun 1.3) |

## Bot Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/status`         | Bot version, server health, current project, session, and model info |
| `/new`            | Create a new session                                    |
| `/abort`          | Abort the current task                                  |
| `/detach`         | Detach from the current session without stopping it     |
| `/sessions`       | Browse and switch between recent sessions               |
| `/messages`       | Browse user messages, revert or fork from a previous state |
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
| `/opencode_stop`  | Stop the local OpenCode server, including during a run  |
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

- Supported locales: `en`, `ar`, `de`, `es`, `fr`, `it`, `ko`, `pt`, `ru`, `zh`
- The setup wizard asks for language first
- You can change locale later with `BOT_LOCALE`

### Local JSON Commands

Trusted local commands live in `<appHome>/local-commands/`, one JSON file per command. The filename becomes the command name, so `quota.json` appears as `/quota` in Telegram’s command menu after the bot restarts:

```json
{
  "description": "Show provider quota limits",
  "exec": "node /home/you/bin/quota.js",
  "allowWhenBusy": true
}
```

`description` and `exec` are required; `description` is a single line of at most 256 characters. Extra fields are ignored. Commands run through the platform shell with the bot’s OS permissions and inherited environment, from `<appHome>`; treat every file in this directory as trusted code. They receive no Telegram text or attachments, never invoke OpenCode, time out after 30 seconds, and are not listed in `/help` or `/commands`. `allowWhenBusy` defaults to `false`; it permits a command while OpenCode is working but never during an active bot interaction.

### Environment Variables

The first time you start the bot, the configuration wizard runs and writes `.env` to your platform's app data directory:

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
| `BOT_LOCALE`                               | Bot UI language (supported locale code, e.g. `en`, `ar`, `de`, `es`, `fr`, `it`, `ko`, `pt`, `ru`, `zh`)              |    No    | `en`                     |
| `SESSIONS_LIST_LIMIT`                      | Sessions per page in `/sessions`                                                                                      |    No    | `10`                     |
| `MESSAGES_LIST_LIMIT`                      | User messages per page in `/messages`                                                                                 |    No    | `10`                     |
| `PROJECTS_LIST_LIMIT`                      | Projects per page in `/projects`                                                                                      |    No    | `10`                     |
| `PROJECTS_EXCLUDED_PATHS`                  | Comma-separated absolute paths hidden from `/projects` (exact worktree match)                                        |    No    | *(none)*                 |
| `OPEN_BROWSER_ROOTS`                       | Comma-separated paths `/open` is allowed to browse (supports `~`)                                                     |    No    | `~` (home directory)     |
| `COMMANDS_LIST_LIMIT`                      | Items per page in `/commands` and `/skills`                                                                           |    No    | `10`                     |
| `MODELS_LIST_LIMIT`                        | Providers and provider models per page in the model picker                                                            |    No    | `10`                     |
| `TASK_LIMIT`                               | Maximum number of scheduled tasks that can exist at once                                                              |    No    | `10`                     |
| `SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES` | Maximum time the bot waits for one scheduled task run before marking it failed                                        |    No    | `120`                    |
| `SCHEDULED_TASK_DISABLE_NOTIFICATION`      | Send scheduled task result/error messages without Telegram push notifications                                         |    No    | `false`                  |
| `BASH_TOOL_DISPLAY_MAX_LENGTH`             | Maximum displayed length for `bash` tool commands in Telegram summaries; longer commands are truncated                |    No    | `128`                    |
| `TRACK_BACKGROUND_SESSIONS`                | Track detached/non-current sessions in the current selected project/worktree and send short notifications             |    No    | `true`                   |
| `MESSAGE_FORMAT_MODE`                      | Assistant reply formatting mode: `markdown` (native Telegram rich blocks) or `raw` (plain text)                       |    No    | `markdown`               |
| `MESSAGE_MERGE_WINDOW_MS`                  | Merge Telegram-split long text messages into one prompt after this wait window (ms); `0` disables merging             |    No    | `1500`                   |
| `INITIAL_SETTINGS_PRESET`                  | JSON object that seeds default `/settings` values on first run (keys not yet persisted); see [Runtime Settings](#runtime-settings) |    No    | `{}`                     |
| `CODE_FILE_MAX_SIZE_KB`                    | Max file size (KB) to send as document                                                                                |    No    | `100`                    |
| `STT_API_URL`                              | Whisper-compatible API base URL (enables voice/audio transcription)                                                   |    No    | —                        |
| `STT_API_KEY`                              | API key for your STT provider                                                                                         |    No    | —                        |
| `STT_MODEL`                                | STT model name passed to `/audio/transcriptions`                                                                      |    No    | `whisper-large-v3-turbo` |
| `STT_LANGUAGE`                             | Optional language hint (empty = provider auto-detect)                                                                 |    No    | —                        |
| `STT_REQUEST_FORMAT`                       | STT request format: `multipart` (standard OpenAI/Groq Whisper) or `json` (base64 `input_audio` body, e.g. OpenRouter) |    No    | `multipart`              |
| `STT_NOTE_PROMPT`                          | Optional note prepended to the LLM prompt as `[Note: ...]` for voice transcriptions; empty / `false` / `0` disable it |    No    | —                        |
| `STT_DOMAIN_FILE`                          | Optional JSON glossary to improve transcription: `hotwords` bias the ASR prompt (product/technical terms) and `corrections` fix recurring misheard tokens |    No    | —                        |
| `DOC_EXTRACTOR_URL`                        | Document text extraction API URL (enables PDF/DOCX/PPTX extraction)                                                    |    No    | —                        |
| `DOC_EXTRACTOR_API_KEY`                    | API key for the document extractor (optional for self-hosted extractors)                                                |    No    | —                        |
| `LOCAL_VISION_API_URL`                     | OpenAI-compatible local vision model base URL. Used as fallback when the active model doesn't support image input: the bot describes your photo locally and sends the description as text | No | `http://127.0.0.1:8082/v1` |
| `LOCAL_VISION_MODEL`                       | Local vision model ID sent to the vision API                                                                           |    No    | `lfm2.5-vl-3b`           |
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
- Delete progress on finish: available while compact output mode is on, removes the progress message when the run completes
- Thinking content display
- Assistant run footer display
- Diff file attachments
- Response streaming mode: `edit` or `draft (experimental)`; applies only to final assistant replies, not thinking messages
- Audio replies: `off`, `all`, or `auto` when TTS is configured
- Message queue: hold text, voice, photos, rich formatted messages with photos, documents, and media groups sent while the agent is busy instead of rejecting them

With the message queue enabled, text, transcribed voice, photos, rich formatted messages with photos, supported documents, and media groups sent while the agent is busy are held instead of being turned down. The queue holds at most `MAX_QUEUED_PROMPTS` (5) items and 20 MiB of raw Telegram media bytes in total; the limit is checked from reliable Telegram `file_size` metadata before media is downloaded or prepared, while base64 data-URI expansion is not counted. Queued media without a reliable source size is refused while the task is busy. Queued messages appear as buttons above the usual bottom-keyboard grid — tap one to drop it. They are sent one at a time as each run finishes, and the queue is cleared by `/abort` or a session/project switch.

You can seed the initial defaults for any of these settings without hard-coding them in your Docker image by setting `INITIAL_SETTINGS_PRESET` to a JSON object. Only keys not yet persisted in `settings.json` are affected — settings the user has already changed via `/settings` are left untouched:

```env
INITIAL_SETTINGS_PRESET={"showAssistantRunFooter":false,"compactOutputMode":true,"ttsMode":"auto"}
```

Settings are written atomically: the new content goes to a temporary file that then replaces `settings.json`, and the previous version is kept as `settings.json.bak`. A crash during a write can never leave a truncated file — the bot falls back to the backup on the next start. If both `settings.json` and `settings.json.bak` are unreadable, the bot refuses to start instead of overwriting them, and the error names the file so you can fix or remove it manually.

### Project Visibility Filter

If you have many OpenCode projects and `/projects` shows ones you don't need, you can whitelist which projects appear. Two ways:

**1. Environment variable** (recommended — survives bot restarts and settings rewrites):

```env
OPENCODE_TELEGRAM_VISIBLE_PROJECTS=/home/user/project-a;/home/user/project-b
```

Semicolon-separated list of full directory paths. Only projects whose worktree path matches one of the listed paths are shown.

**2. `settings.json`** (overwritten by the bot on every settings change — prefer env var):

```json
{
  "visibleProjects": ["/home/user/project-a", "/home/user/project-b"]
}
```

When unconfigured, all projects are shown (backward compatible). The env var takes precedence over `settings.json`.

You can seed the initial defaults for any of these settings without hard-coding them in your Docker image by setting `INITIAL_SETTINGS_PRESET` to a JSON object. Only keys not yet persisted in `settings.json` are affected — settings the user has already changed via `/settings` are left untouched:

```env
INITIAL_SETTINGS_PRESET={"showAssistantRunFooter":false,"compactOutputMode":true,"ttsMode":"auto"}
```

Settings are written atomically: the new content goes to a temporary file that then replaces `settings.json`, and the previous version is kept as `settings.json.bak`. A crash during a write can never leave a truncated file — the bot falls back to the backup on the next start. If both `settings.json` and `settings.json.bak` are unreadable, the bot refuses to start instead of overwriting them, and the error names the file so you can fix or remove it manually.

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

`STT_DOMAIN_FILE` points to a JSON glossary that improves recognition of domain vocabulary (product names, technical/English terms in mixed-language speech):

```json
{
  "hotwords": ["rudabook", "primigenum", "mergea", "schedules", "GPU"],
  "corrections": { "rutabug": "rudabook", "esquetules": "schedules" }
}
```

- `hotwords` are sent as the `prompt` field of the transcription request (`multipart` format only) to bias the ASR model towards this vocabulary.
- `corrections` are applied to the recognized text after transcription (case-insensitive, word boundaries, accent-tolerant, longest keys first) and are reflected in the chat message.

The file is optional and reloaded on every transcription, so edits apply without restarting the bot.

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

### Document Text Extraction (Optional)

If `DOC_EXTRACTOR_URL` is set, the bot will extract text from PDF, DOCX, PPTX, and other document files using an external API when the current model does not natively support document input.

The API contract is:

- **Endpoint:** `POST {DOC_EXTRACTOR_URL}`
- **Content-Type:** `multipart/form-data`
- **Field:** `file` — the document binary
- **Authorization:** `Bearer {DOC_EXTRACTOR_API_KEY}` (only sent when a key is configured)
- **Response:** JSON `{ "text": "extracted content..." }`

If the extractor is not configured and the model doesn't support documents, the bot replies with a notice and forwards only the caption text.

### Local Vision for Photos (Optional)

If you send a photo and the active model doesn't support image input, the bot falls back to a **local vision model** (default: `LFM2.5-VL-3B` via llama.cpp on `127.0.0.1:8082`):

1. The bot downloads your photo and sends it to the local vision endpoint
2. The local model describes it (all visible text, layout, statuses) — 100% local, nothing leaves your machine
3. The description is sent to OpenCode as text, together with your caption

If the model DOES support images, the photo is sent directly as an image part (default behavior).

```env
# Optional — defaults work for a llama.cpp vision server on the same machine:
LOCAL_VISION_API_URL=http://127.0.0.1:8082/v1
LOCAL_VISION_MODEL=lfm2.5-vl-3b
```

Full setup guide (model download + llama.cpp server): see [docs/LOCAL_VISION.md](./docs/LOCAL_VISION.md).

### Videos

Videos sent as video messages or as `video/*` documents are downloaded and saved to the agent upload directory (`LOCAL_VISION_UPLOAD_DIR`, default `~/.opencode/uploads`). The saved path is appended to your caption, so the agent can process the original file locally — e.g. extract frames with `ffmpeg` while building a 3D model of a location. Downloads are limited to 20 MB per file (Telegram Bot API limit); send shorter clips or compressed videos for anything larger.

### Model Configuration

The model picker uses OpenCode local model state (`favorite` + `recent`):

- Favorites are shown first, then recent
- Models already in favorites are not duplicated in recent
- Current model is marked with `✅`
- Default model from `OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID` is always included in favorites

To add a model to favorites, open OpenCode TUI (`opencode`), go to model selection, and press **Cmd+F/Ctrl+F** on the model.

To pick a model that is neither a favorite nor recent, tap **🗂 Providers** in the model picker: it lists the connected providers, then the models of the selected one, both paginated by `MODELS_LIST_LIMIT`.

## Security

The bot enforces a strict **user ID whitelist**. Only the Telegram user whose numeric ID matches `TELEGRAM_ALLOWED_USER_ID` can interact with the bot. Messages from any other user are silently ignored and logged as unauthorized access attempts.

Since the bot runs locally on your machine and connects to your local OpenCode server, there is no external attack surface beyond the Telegram Bot API itself.

## Development

```bash
bun install                # install deps
bun run check              # lint + build + tests (quality gate)
bun test                   # run tests
bun test tests/utils       # one directory
bunx vitest watch ...      # if you ever need vitest — but the shim is now the canonical path
```

The lint, format, and TypeScript configs are unchanged from upstream (ESLint + Prettier) — they run on `bunx`, no Node involved.

### Docker Deployment

The bot can also be run as a container using Docker and Docker Compose. The image contains **only the Telegram bot**. OpenCode stays on the host and must already be running before you start the container (`opencode serve --port 4096`). `/opencode_start` and `/opencode_stop` do not work from inside the container.

```bash
git clone https://github.com/primigenum/opencode-telegram-bot.git
cd opencode-telegram-bot
cp .env.example .env
# Edit .env with your bot token, user ID, and model settings
```

`.env` stays on the host. It is injected at runtime and is not copied into the image.

**Linux** (OpenCode on the host at `127.0.0.1:4096`):

```bash
docker compose up -d --build
```

**macOS / Windows (Docker Desktop):** host networking does not reach OpenCode on the Windows/macOS localhost. Use the Desktop override, which talks to the host via `host.docker.internal`:

```bash
docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d --build
```

Follow logs:

```bash
docker compose logs -f opencode-bot
```

Stop:

```bash
docker compose down
```

#### Persistence

Runtime state (settings, logs, SQLite databases) is stored in a Docker named volume `opencode-bot-data` mapped to `/app/data` inside the container. The volume is created automatically on first run. It is the bot's own state, not your project files. OpenCode on the host continues to edit projects on the host disk.

#### Configuration

All configuration is provided through environment variables in the `.env` file. Compose also sets `OPENCODE_TELEGRAM_CONTAINER=1` so the bot can warn about commands that need the host filesystem or a local OpenCode process.

- `OPENCODE_API_URL` — URL of the OpenCode server. On Linux with the default compose file this is `http://127.0.0.1:4096` via `network_mode: host`. The Desktop override sets `http://host.docker.internal:4096`.

#### Commands that are not available in Docker

These need the bot process to see host project paths or to spawn/stop `opencode` in the same machine namespace. The default image does neither, so the bot replies with a warning instead of a generic error:

- `/open` — directory browser to add a project
- `/ls` — project file browser / download / attach
- `/opencode_start` and `/opencode_stop`
- `/worktree`

`/projects`, `/sessions`, prompts, and live updates still go through the OpenCode HTTP API and work as usual.

Port 4096 is **not** exposed by the bot image; it belongs to the OpenCode server, which runs separately.

## Test status

The test suite runs on **`bun test`** through a thin vitest-compatible shim at `tests/helpers/vitest-shim.ts` — most test files are unchanged apart from `import { ... } from "vitest"` → `import { ... } from "#vitest"` (subpath alias in `package.json` `imports`).

This is a partial port. Two vitest patterns have **no equivalent in bun's test runner** and are not polyfillable through the shim:

1. **`vi.mock(module, factory)` for module-level mocking** — vitest hoists `vi.mock` to the top of the file via its transformer. Bun's `mock.module()` is a runtime call, so static `import` statements in the test file load the real module before the mock is registered.
2. **`vi.resetModules()` + `await import(...)`** — bun has no public module cache reset API.

Lint, build, and runtime are green. Tests that don't use the two patterns above pass. For the full breakdown of what the shim covers, the bun limitations, the affected test files, and the open follow-ups, see **[`docs/BUN_PORT.md`](./docs/BUN_PORT.md)** — that doc is the canonical reference for the port.

## Support

This project is free and open source. Development and testing run on paid AI model subscriptions, and donations go directly toward those.

If you find this bot useful, you can support it here: [Donate](https://donate.trybit.com/D9J1UVKT)

Any amount helps — thank you!

## License

[MIT](LICENSE) — fork of grinev/opencode-telegram-bot by Ruslan Grinev (MIT). All new code in this fork is also MIT.
