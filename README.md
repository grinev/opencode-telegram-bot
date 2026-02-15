# OpenCode Telegram Bot

[![npm version](https://img.shields.io/npm/v/@grinev/opencode-telegram-bot)](https://www.npmjs.com/package/@grinev/opencode-telegram-bot)
[![CI](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

Control your [OpenCode](https://opencode.ai) coding agent from your phone. Send tasks, switch models, monitor progress — all through Telegram.

No open ports, no exposed APIs. The bot runs on your machine alongside OpenCode and communicates exclusively through the Telegram Bot API.

<p align="center">
  <img src="assets/Screenshot-1.png" width="32%" alt="Sending a coding task and receiving file edit results" />
  <img src="assets/Screenshot-2.png" width="32%" alt="Live session status with context usage and changed files" />
  <img src="assets/Screenshot-3.png" width="32%" alt="Switching between AI models from favorites" />
</p>

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Live status** — pinned message with current project, model, context usage, and changed files list, updated in real time
- **Model switching** — pick any model from your OpenCode favorites directly in the chat
- **Agent modes** — switch between Plan and Build modes on the fly
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Context control** — compact context when it gets too large, right from the chat
- **Security** — strict user ID whitelist; no one else can access your bot, even if they find it
- **Localization** — English and Russian UI (`BOT_LOCALE=en|ru`)

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

In your project directory, start the OpenCode server:

```bash
opencode serve
```

> The bot connects to the OpenCode API at `http://localhost:4096` by default.

### 3. Install & Run

The fastest way — run directly with `npx`:

```bash
npx @grinev/opencode-telegram-bot
```

On first launch, an interactive wizard will guide you through the configuration — it will ask for your bot token, user ID, and OpenCode API URL. After that, you're ready to go. Open your bot in Telegram and start sending tasks.

#### Alternative: Global Install

```bash
npm install -g @grinev/opencode-telegram-bot
opencode-telegram start
```

To reconfigure at any time:

```bash
opencode-telegram config
```

## Supported Platforms

| Platform | Status                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | Fully supported                                                                                                                      |
| Windows  | Fully supported                                                                                                                      |
| Linux    | Experimental — should work, but has not been extensively tested. You may need additional steps such as granting execute permissions. |

## Bot Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/status`         | Server health, current project, session, and model info |
| `/new`            | Create a new session                                    |
| `/stop`           | Abort the current task                                  |
| `/sessions`       | Browse and switch between recent sessions               |
| `/projects`       | Switch between OpenCode projects                        |
| `/model`          | Choose a model from your favorites                      |
| `/agent`          | Switch agent mode (Plan / Build)                        |
| `/opencode_start` | Start the OpenCode server remotely                      |
| `/opencode_stop`  | Stop the OpenCode server remotely                       |
| `/help`           | Show available commands                                 |

Any regular text message is sent as a prompt to the coding agent.

> `/opencode_start` and `/opencode_stop` are intended as emergency commands — for example, if you need to restart a stuck server while away from your computer. Under normal usage, start `opencode serve` yourself before launching the bot.

## Configuration

### Environment Variables

When installed via npm, the configuration wizard handles the initial setup. The `.env` file is stored in your platform's app data directory:

- **macOS:** `~/Library/Application Support/opencode-telegram-bot/.env`
- **Windows:** `%APPDATA%\opencode-telegram-bot\.env`
- **Linux:** `~/.config/opencode-telegram-bot/.env`

| Variable                   | Description                                  | Required | Default                 |
| -------------------------- | -------------------------------------------- | :------: | ----------------------- |
| `TELEGRAM_BOT_TOKEN`       | Bot token from @BotFather                    |   Yes    | —                       |
| `TELEGRAM_ALLOWED_USER_ID` | Your numeric Telegram user ID                |   Yes    | —                       |
| `TELEGRAM_PROXY_URL`       | Proxy URL for Telegram API (SOCKS5/HTTP)     |    No    | —                       |
| `OPENCODE_API_URL`         | OpenCode server URL                          |    No    | `http://localhost:4096` |
| `OPENCODE_SERVER_USERNAME` | Server auth username                         |    No    | `opencode`              |
| `OPENCODE_SERVER_PASSWORD` | Server auth password                         |    No    | —                       |
| `OPENCODE_MODEL_PROVIDER`  | Default model provider                       |   Yes    | `opencode`              |
| `OPENCODE_MODEL_ID`        | Default model ID                             |   Yes    | `big-pickle`            |
| `BOT_LOCALE`               | Bot UI language (`en` or `ru`)               |    No    | `en`                    |
| `SESSIONS_LIST_LIMIT`      | Max sessions shown in `/sessions`            |    No    | `10`                    |
| `CODE_FILE_MAX_SIZE_KB`    | Max file size (KB) to send as document       |    No    | `100`                   |
| `LOG_LEVEL`                | Log level (`debug`, `info`, `warn`, `error`) |    No    | `info`                  |

> **Keep your `.env` file private.** It contains your bot token. Never commit it to version control.

### Model Configuration

The bot picks up your **favorite models** from OpenCode. To add a model to favorites:

1. Open OpenCode TUI (`opencode`)
2. Go to model selection
3. Hover over the model you want and press **Ctrl+F** to add it to favorites

These favorites will appear in the `/model` command menu in Telegram.

A free model (`opencode/big-pickle`) is configured as the default fallback — if you haven't set up any favorites yet, the bot will use it automatically.

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

- Ensure `opencode serve` is running in your project directory
- Check that `OPENCODE_API_URL` points to the correct address (default: `http://localhost:4096`)

**No models in `/model` menu**

- Add models to your OpenCode favorites: open OpenCode TUI, go to model selection, press **Ctrl+F** on desired models

**Linux: permission denied errors**

- Make sure the CLI binary has execute permission: `chmod +x $(which opencode-telegram)`
- Check that the config directory is writable: `~/.config/opencode-telegram-bot/`

## Contributing

Please follow commit and release note conventions in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Ruslan Grinev
