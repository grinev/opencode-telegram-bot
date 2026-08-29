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
- Switching to an existing session adopts the agent, model, and variant it last ran with
- Create a new session
- Use OpenCode-generated session title (based on conversation)

### Task handling

- Send text prompts to OpenCode
- Accept voice/audio messages, transcribe via Whisper-compatible STT API, and forward recognized text as prompts
- Interrupt current task (ESC equivalent)
- Optionally queue text messages sent while a task is running (max 5) and send them one by one after completion
- Handle OpenCode questions with inline options and custom text answers
- Send selected/custom answers back to OpenCode (`question.reply`)
- Handle permission requests interactively (`allow once` / `always` / `reject`)

### Result delivery

- Send each completed assistant response after completion signal from SSE
- Show elapsed time for tool calls running longer than 20 seconds, updated on a timer so it keeps counting while a tool blocks without producing output; covers subagent cards and compact mode, and the total duration stays on the finished tool line. A finished subagent card keeps the time its whole run took. Durations use the same `· 🕒 1h 2m 3s` format as the assistant run footer
- Render assistant replies with native Telegram formatting: real tables with the column alignment declared in markdown, bullet lists with their nesting, block quotes that keep their nested content, headings, and syntax-highlighted code. Numbered lists and checklists keep literal markers (`1.`, ✅/🔲), because Telegram clients number a native ordered list from zero and do not draw the native checkbox at all
- Deliver reasoning as a collapsed quote that expands on tap
- Hide full model reasoning by default; optionally stream it in the thinking message when explicitly enabled
- Stream intermediate assistant/tool/thinking edits and pinned file-change updates once per second for the first minute, then slow down to 2s / 5s / 10s so long runs stay under Telegram rate limits; the interval resets when the run stops
- Split long responses into multiple Telegram messages, which is now rare: native messages hold 32768 characters instead of 4096
- Send code updates as files (size-limited)

### Session status in chat

- Keep a pinned status message in the chat
- Show session title, project, model, context usage, and changed files
- Auto-update status from SSE and tool events
- Preserve pinned message ID across bot restarts

### Security

- Whitelist by Telegram user ID (single-user mode)
- Ignore messages from non-authorized users
- Ignore updates queued while the bot was offline or unreachable, so they are not executed on startup

### Configuration

- Telegram bot token
- Allowed Telegram user ID
- Default model provider and model ID
- Selected project persisted in `settings.json`
- Configurable sessions list size (default: 10)
- Configurable commands list size (default: 10)
- Configurable scheduled task limit (default: 10)
- Configurable bot locale
- Configurable visibility for thinking content and diff-file attachments
- Configurable compact output, assistant footer, message queue, and TTS modes (`/settings`)
- Configurable opt-in display of full thinking/reasoning content
- Configurable max code file size in KB (default: 100)
- Optional STT settings for voice transcription (`STT_API_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`)
- Optional TTS settings for global audio replies (`TTS_PROVIDER`, `TTS_API_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`); supported providers: OpenAI-compatible, ElevenLabs, Google Cloud TTS, and Microsoft Edge TTS (no API key required)
- Optional IPv4-only mode for Telegram connectivity (`TELEGRAM_FORCE_IPV4`)

## Current Product Scope

### Bot commands

Current command set:

- `/status` - server, project, and session status
- `/new` - create a new session
- `/abort` - stop the current task
- `/detach` - detach the bot from the current session without stopping it
- `/sessions` - show and switch recent sessions
- `/messages` - browse user messages in the current session
- `/projects` - show and switch projects
- `/worktree` - show and switch existing git worktrees for the current repository
- `/settings` - change bot settings
- `/task` - create a scheduled task
- `/tasklist` - browse and delete scheduled tasks
- `/rename` - rename current session
- `/commands` - browse and run custom commands (plus built-ins like `init` and `review`)
- `/skills` - browse and run OpenCode skills
- `/opencode_start` - start local OpenCode server
- `/opencode_stop` - stop local OpenCode server; available during an active request and kills the local process even if health is hung
- `/help` - show command help
- `/ls` - interactive file browser for the current project directory; a text file can be attached to the next prompt from its detail view

Model, agent, variant, and context actions are available from the persistent bottom keyboard.

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. When TTS mode in `/settings` is set to `all`, completed assistant replies include a generated audio file if TTS is configured. When it is set to `auto`, audio replies are sent only after voice/audio prompts.

Interaction routing rules:

- Only one interactive flow can be active at a time (inline menu, permission, question, rename, commands, skills, messages)
- While an interaction is active, unrelated input is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/abort`, `/detach`, `/opencode_stop`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/abort`, `/detach`, reset/cleanup)

Model picker behavior:

- Uses OpenCode local model state (`favorite` + `recent`)
- Favorites are shown first, recent models are shown after favorites
- Models already present in favorites are not duplicated in recent
- Default configured model (`OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID`) is treated as favorite
- Models can be browsed by provider: the picker offers a providers list and a paginated model
  list per provider, with a back button on each screen (page size: `MODELS_LIST_LIMIT`)
- Picking a model opens the variant picker right after the confirmation when the model offers
  more than one selectable variant; a model with only `Default` ends at the confirmation

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
- [x] Scheduled task creation flow (`/task`), remembering the agent selected at creation and showing it (alongside the model) in the task confirmation and task details
- [x] Scheduled task runtime execution with deferred Telegram delivery
- [x] Scheduled task list and deletion flow (`/tasklist`)
- [x] Persistent settings between restarts (`settings.json`)
- [x] UI localization support via i18n files
- [x] Service message visibility controls (thinking content and diff-file attachments)
- [x] Sending code blocks as text files when needed
- [x] Image attachments support (send photos/screenshots from Telegram to OpenCode, including multiple files in one Telegram album)
- [x] PDF attachments support (send documents from Telegram to OpenCode)
- [x] Text file attachments support (send code/config/log files from Telegram to OpenCode)
- [x] Voice/audio transcription via Whisper-compatible APIs (OpenAI/Groq/Together and compatible providers)
- [x] Optional audio replies with `/settings` modes via OpenAI-compatible APIs
- [x] Dynamic subagent activity display during task execution
- [x] Git worktree switching and main-project status display for git repositories (`/worktree`)
- [x] Create new OpenCode projects directly from Telegram
- [x] `/mcps` command: browse available MCP servers
- [x] Optional local OpenCode server monitoring with automatic restart
- [x] Interactive project file browsing and file download from Telegram (`/ls`)
- [x] Attaching a project file from `/ls` to the next prompt as a native OpenCode file part
- [x] `/messages` command: browse session messages with revert and fork functionality
- [x] Optional message queue for text sent while the agent is busy, managed from the bottom keyboard
- [x] Native Telegram rich message formatting for assistant replies (Bot API 10.1)

## Current Task List

Open tasks for upcoming iterations:

- [ ] Model search in model switcher
- [x] Docker runtime support and deployment guide
- [x] Add a bot settings command with in-chat UI
