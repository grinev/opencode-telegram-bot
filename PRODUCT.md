# OpenCode Telegram Bridge

Telegram bot client for OpenCode that lets you run and monitor coding tasks on your local machine from Telegram.

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

### Project management

- Fetch available projects from OpenCode API (name + path)
- Select and switch projects
- Persist selected project between restarts (`settings.json`)

### Session management

- Fetch last N sessions (name + date)
- Select and attach to an existing session
- Create a new session
- Use OpenCode-generated session title (based on conversation)

### Task handling

- Send text prompts to OpenCode
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
- Configurable bot locale
- Configurable visibility for service messages (thinking/tool calls)
- Configurable max code file size in KB (default: 100)

## Current Product Scope

### Bot commands

Current command set:

- [x] `/status` - server, project, and session status
- [x] `/new` - create a new session
- [x] `/stop` - stop the current task
- [x] `/sessions` - show and switch recent sessions
- [x] `/projects` - show and switch projects
- [x] `/model` - select model
- [x] `/agent` - select agent mode
- [x] `/rename` - rename current session
- [x] `/opencode_start` - start local OpenCode server
- [x] `/opencode_stop` - stop local OpenCode server
- [x] `/help` - show command help

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active.

Interaction routing rules:

- Only one interactive flow can be active at a time (inline menu, permission, question, rename)
- While an interaction is active, unrelated input is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/stop`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/stop`, reset/cleanup)

### Main features already implemented

- [x] OpenCode server control and health checks via bot commands
- [x] Project management (list/switch) with inline menus
- [x] Session management (list/switch/create) with inline menus
- [x] Prompt execution through OpenCode with SSE-based event handling
- [x] Interactive question and permission flows (buttons + custom text answers)
- [x] Single-active interaction routing with contextual blocking and cleanup recovery
- [x] Pinned status updates (session, project, model, context usage, changed files)
- [x] Model and agent selection from Telegram
- [x] Context/variant controls from Telegram keyboard
- [x] Sending code blocks as files when needed
- [x] Configurable batching of service messages (thinking + tool updates): recommended `>=2` sec for Telegram rate limits; `0` = immediate
- [x] Configurable service message visibility via env flags (`HIDE_THINKING_MESSAGES`, `HIDE_TOOL_CALL_MESSAGES`)
- [x] Single-user security model (allowed Telegram user ID)
- [x] Persistent bot settings (`settings.json`) between restarts
- [x] EN/RU localization structure via dedicated i18n files

## Current Task List

Open tasks for upcoming iterations:

- [ ] Display MCP servers, formatters, and plugins in bot status/details
- [x] Configure visibility level for thinking and intermediate steps
- [ ] Add server crash notifications in Telegram
- [ ] Add periodic health checks and optional auto-restart for OpenCode server
- [ ] Improve Telegram-compatible message formatting for richer outputs
- [ ] Support sending files from Telegram to OpenCode (screenshots, documents)
- [ ] Provide a Docker image and basic container deployment guide
- [ ] Add voice transcription

## Possible Improvements

Optional or longer-term enhancements:

- [ ] Create new OpenCode projects directly from Telegram
- [ ] Add project file browsing helpers (for example, `ls` and `open` flows)
- [ ] Improve support for git worktree-based workflows
