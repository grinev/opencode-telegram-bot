---
title: OpenCode Telegram Bot
summary: Telegram bot for opencode — Bun port of the grinev/opencode-telegram-bot repository
sources: [AGENTS.md, MEMORY.md]
last_updated: 2026-06-22
tags: [service, bot, telegram, opencode, configuration]
---

# OpenCode Telegram Bot

## Stack
- **Runtime**: Bun
- **Framework**: grammY
- **Base**: fork of `grinev/opencode-telegram-bot`, ported to Bun

## Role
Telegram bot that allows interacting with opencode from Telegram. Separate repo at `github.com/primigenum/opencode-telegram-bot`.

## Development
- Run with `bun run dev:bot` (uses Bun's `--watch` for auto-reload)
- **Do not kill + respawn** — edit source and let `--watch` reload
- Known bug: `--watch` doesn't reload in Bun 1.3.14. Workaround: `kill -TERM <pid>` + restart

## PR workflow
- Base: `main`
- Feature branch → PR → merge

## Scheduled Tasks (crons via Telegram)

The bot allows scheduling periodic or one-shot tasks that run against opencode unsupervised.

### Creation (`/task`)

1. Select a project with `/projects` (the task is linked to the active project)
2. Run `/task`
3. Describe the schedule in natural language: `"every day at 9am Europe/Madrid"`, `"every 30 minutes"`, `"weekdays at 18:00"`
4. The bot uses opencode to convert the text to a cron expression
5. Confirms the schedule and asks for the prompt
6. Write what you want opencode to do: `"run tests"`, `"check for vulnerabilities"`
7. The task is registered and will run according to the schedule

### Visualization (`/tasklist`)

- Lists all scheduled tasks
- When you open one: shows details (prompt, project, model, agent, schedule, next run)
- Delete button

### Persistence

- Tasks are saved in the bot's `settings.json`
- They survive bot restarts (recovered on startup)
- Tasks in `running` state on restart are marked as `error`

### Configurable agent (added 2026-06-24)

Each task captures the **opencode agent** you have selected when creating it:

| Agent | Behavior in the task |
|-------|----------------------|
| `build` (default) | Asks for confirmation before editing files |
| `bypass` | Auto-approves everything — maximum power, useful for autonomous tasks |
| `general` | Balanced, for research tasks |

- The agent is shown in the task details (`🛠️ Build · openai/gpt-5`)
- If there's no agent (pre-existing tasks), fallback to `build`
- The result message shows which agent was actually used

## Project Visibility Filter (added 2026-06-24)

If `/projects` shows projects you don't want to see, you can whitelist paths. Two ways:

### 1. Environment variable (recommended)

Add to the bot's `.env`:

```env
OPENCODE_TELEGRAM_VISIBLE_PROJECTS=/home/ovreuc/primigenum;/home/ovreuc/salud;/home/ovreuc/sistema;/home/ovreuc/music
```

Full paths separated by semicolons. Only projects whose path matches are shown (case-insensitive, tolerates trailing slashes).

**Why better than settings.json:** the bot rewrites `settings.json` every time something changes (current project, session, etc.), so any manual edit is lost. The env var is loaded from `.env` on startup and the bot never touches it.

### 2. settings.json

```json
{
  "visibleProjects": ["/home/ovreuc/primigenum", "/home/ovreuc/salud"]
}
```

The env var takes priority over settings.json. If neither is configured, all projects are shown (backward compatible).

### Known limitations

- The timer uses Bun's native `setTimeout` (max ~24.8 days per tick, but chains automatically)
- No editing of existing tasks — only delete and recreate
- No manual trigger (`/taskrun` doesn't exist yet)
- No pause / resume
- Tasks that require interactive questions or permissions are auto-rejected and fail
- The delivery queue is in-memory (lost if the bot crashes before sending)
