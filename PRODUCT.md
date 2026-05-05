# OpenCode Telegram Bot

Telegram bot client for OpenCode that lets you run and monitor coding tasks on your local machine from Telegram.

> Project concept and boundaries are documented in [`CONCEPT.md`](./CONCEPT.md).
> Proposed changes that alter the core interaction model should be discussed before implementation.

## Concept

The app works as a bridge between Telegram and a locally running OpenCode server:

- You send prompts from Telegram
- The bot forwards them to OpenCode
- The app listens to OpenCode SSE events
- Results are aggregated and sent back in Telegram-friendly format

No public inbound ports are required for normal usage.

## Target Usage Scenario

1. The user works on a project locally with OpenCode (Desktop/TUI).
2. They finish the local session and leave the computer.
3. Later, while away, they run this bridge service and connect via Telegram.
4. They choose an existing session or create a new one.
5. They send coding tasks and receive periodic progress updates.
6. They receive completed assistant responses in chat and continue the workflow asynchronously.

## Functional Requirements

### OpenCode server management

- Check OpenCode server status (running / not running)
- Start OpenCode server from the app (`opencode serve`)
- Stop OpenCode server from the app
- Optionally monitor and auto-restart a local OpenCode server

### Project management

- Fetch available projects from OpenCode API (name + path)
- Select and switch projects
- Persist selected project between restarts (`settings.json`)

### Session management

- Fetch last N sessions (name + date)
- Select an existing session and automatically follow its live updates
- Create a new session
- Use OpenCode-generated session title (based on conversation)

### Task handling

- Send text prompts to OpenCode
- Accept voice/audio messages, transcribe via Whisper-compatible STT API, and forward recognized text as prompts
- Interrupt current task (ESC equivalent)
- Handle OpenCode questions with inline options and custom text answers
- Send selected/custom answers back to OpenCode (`question.reply`)
- Handle permission requests interactively (`allow once` / `always` / `reject`)

### Result delivery

- Send each completed assistant response after completion signal from SSE
- Do not expose raw chain-of-thought; send a lightweight thinking indicator instead
- Split long responses into multiple Telegram messages
- Send code updates as files (size-limited)

### Session status in chat

- Keep a pinned status message in the chat
- Show session title, project, model, context usage, and changed files
- Auto-update status from SSE and tool events
- Preserve pinned message ID across bot restarts

### Security

- Whitelist by Telegram user ID (single-user mode)
- Ignore messages from non-authorized users

### Configuration

- Telegram bot token
- Allowed Telegram user ID
- Default model provider and model ID
- Selected project persisted in `settings.json`
- Configurable sessions list size (default: 10)
- Configurable commands list size (default: 10)
- Configurable scheduled task limit (default: 10)
- Configurable bot locale
- Configurable visibility for service messages (thinking/tool calls)
- Configurable max code file size in KB (default: 100)
- Optional STT settings for voice transcription (`STT_API_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`)
- Optional TTS settings for global audio replies (`TTS_API_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`)

## Current Product Scope

### Bot commands

Current command set:

- `/status` - server, project, and session status
- `/new` - create a new session
- `/abort` - stop the current task
- `/detach` - detach the bot from the current session without stopping it
- `/sessions` - show and switch recent sessions
- `/projects` - show and switch projects
- `/worktree` - show and switch existing git worktrees for the current repository
- `/tts` - toggle global audio replies
- `/task` - create a scheduled task
- `/tasklist` - browse and delete scheduled tasks
- `/rename` - rename current session
- `/commands` - browse and run custom commands (plus built-ins like `init` and `review`)
- `/skills` - browse and run OpenCode skills
- `/opencode_start` - start local OpenCode server
- `/opencode_stop` - stop local OpenCode server
- `/help` - show command help
- `/ls` - interactive file browser for the current project directory

Model, agent, variant, and context actions are available from the persistent bottom keyboard.

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. When `/tts` is enabled globally, completed assistant replies also include a generated audio file if TTS is configured.

Interaction routing rules:

- Only one interactive flow can be active at a time (inline menu, permission, question, rename, commands, skills)
- While an interaction is active, unrelated input is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/abort`, `/detach`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/abort`, `/detach`, reset/cleanup)

Model picker behavior:

- Uses OpenCode local model state (`favorite` + `recent`)
- Favorites are shown first, recent models are shown after favorites
- Models already present in favorites are not duplicated in recent
- Default configured model (`OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID`) is treated as favorite

### Main features already implemented

- [x] Single-user access control by allowed Telegram user ID
- [x] OpenCode server control from Telegram (`/status`, `/opencode_start`, `/opencode_stop`)
- [x] Project and session management from Telegram (`/projects`, `/worktree`, `/sessions`, `/new`)
- [x] Automatic tracking of the current OpenCode CLI session, including continuing it from Telegram, live updates, and external text input notifications
- [x] Remote task execution, interruption, and local detachment support (`/abort`, `/detach`)
- [x] Background notifications for detached/non-current sessions in the currently selected project/worktree
- [x] Telegram-friendly result delivery, including sending generated code/files when needed
- [x] Interactive question and permission handling directly in chat (buttons + custom answers)
- [x] Live pinned session status in chat (project, model, context usage, changed files)
- [x] In-chat controls for model, agent, variant, and context
- [x] Built-in and custom command catalog access (`/commands`)
- [x] Skills catalog access (`/skills`)
- [x] Scheduled task creation flow (`/task`)
- [x] Scheduled task runtime execution with deferred Telegram delivery
- [x] Scheduled task list and deletion flow (`/tasklist`)
- [x] Persistent settings between restarts (`settings.json`)
- [x] UI localization support via i18n files
- [x] Service message visibility controls (thinking/tool updates)
- [x] Sending code blocks as text files when needed
- [x] Image attachments support (send photos/screenshots from Telegram to OpenCode)
- [x] PDF attachments support (send documents from Telegram to OpenCode)
- [x] Text file attachments support (send code/config/log files from Telegram to OpenCode)
- [x] Voice/audio transcription via Whisper-compatible APIs (OpenAI/Groq/Together and compatible providers)
- [x] Optional global audio replies with `/tts` via OpenAI-compatible APIs
- [x] Dynamic subagent activity display during task execution
- [x] Git worktree switching and main-project status display for git repositories (`/worktree`)
- [x] Create new OpenCode projects directly from Telegram
- [x] `/mcps` command: browse available MCP servers
- [x] Optional local OpenCode server monitoring with automatic restart
- [x] Interactive project file browsing and file download from Telegram (`/ls`)

## Current Task List

Open tasks for upcoming iterations:

- [ ] `/messages` command: browse session messages with fork/revert actions
- [ ] Model search in model switcher
- [ ] Docker runtime support and deployment guide
- [ ] Add a bot settings command with in-chat UI
