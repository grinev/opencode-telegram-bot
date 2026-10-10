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

- Works with OpenCode V1 and OpenCode V2 servers; the API version is set in configuration (`OPENCODE_SERVER_VERSION`, default V1) and a server of the other version is reported in the log
- Check OpenCode server status (running / not running)
- Start OpenCode server from the app: `opencode serve` on V1, the registered background server (`opencode serve --service`) on V2; no start while the configured address answers with the wrong password or as the other version, while the local `opencode` executable is the other version, or on V2 while a registered V2 server runs on another port — the reason goes to the log
- Stop OpenCode server from the app
- Optionally monitor and auto-restart a local OpenCode server, with the same start rules

### Project management

- Fetch available projects from OpenCode API (name + path)
- Select and switch projects
- Persist selected project between restarts (`settings.json`)

### Session management

- Fetch last N sessions (name + date)
- Select an existing session, show the last user input as a quote and the last assistant reply in full, then follow its live updates
- Browse up to `SESSIONS_LIST_LIMIT` recent root sessions across projects and git worktrees with running, idle, question and permission status (a question or permission request a subagent is waiting on counts for its root session); select one to switch project and follow it, including after detach
- Switching to an existing session adopts the agent, model, and variant it last ran with
- Create a new session
- Use OpenCode-generated session title (based on conversation); a session OpenCode has not named yet is shown as "new session" wherever the bot names a session, and `/status`, `/rename` and `/detach` name the current session with the title OpenCode has for it at that moment

### Task handling

- Send text prompts to OpenCode
- Accept voice/audio messages, transcribe via Whisper-compatible STT API, and forward recognized text as prompts
- Interrupt current task (ESC equivalent)
- Optionally accept text, transcribed voice, photos, rich formatted messages with photos, supported documents, and media groups sent while a task is running, at most `MAX_QUEUED_PROMPTS` (5) waiting at a time: on OpenCode V2 they wait in the session inbox and are steered into the running turn (Steer, the V2 default) or start their own run after it (Queue); on V1 the bot holds them, with at most 20 MiB of raw Telegram media bytes checked from reliable `file_size` before downloads; the V1 On/Off choice and the V2 mode are kept separately, so switching versions changes neither; `/detach` leaves waiting messages to the detached session, where they are sent as if the bot had stayed attached, with the agent and model selected at `/detach`
- On OpenCode V2 the waiting-message buttons follow the session inbox across an event-stream reconnect: a message picked up or withdrawn while the stream was down loses its button once it is back, without a quote; one still waiting keeps its button and its later pickup is quoted as usual
- Handle OpenCode questions with inline options and custom text answers; the custom answer button is offered only when the question accepts a custom answer
- Questions asked by a subagent of the followed session appear in the chat like the main agent's and are answered to that subagent
- A question answered or cancelled outside Telegram (OpenCode TUI, web, another client) closes the poll on screen: its buttons go and a line says it was answered or cancelled outside Telegram
- The poll's Cancel button dismisses the whole question request in OpenCode (`question.reject`), for the main agent and for a subagent alike: once OpenCode takes it the poll turns into `❌ Poll cancelled`, answers already chosen are not sent, and the agent's turn ends without a reply or footer; a Cancel that does not reach OpenCode leaves the poll answerable with a line saying so
- In a multi-select question the custom text becomes one more tickable row next to the options, and Done sends it together with the ticked options
- Send selected/custom answers back to OpenCode (`question.reply`); on V2 a tapped choice is sent as the value OpenCode expects, while the buttons and the summary show its label
- The poll's last question stays on screen until OpenCode takes the answers, then gives way to the summary; answers that do not reach OpenCode, or that OpenCode rejects, leave the poll answerable with a warning line (a choice is tapped again, a custom answer typed again after a new Custom answer tap); answers to a question OpenCode already settled close the poll as answered or cancelled outside Telegram
- A poll whose question ended before the poll reached the chat (answered or cancelled outside Telegram, `/abort`, the run ending) is not shown; one already on its way when that happened loses its buttons as it lands and gets the line of how the question ended
- A poll on screen dropped by `/abort`, `/detach`, `/opencode_stop`, `/new`, a session or project switch keeps its question text, loses its buttons and ends with `⏹ Not answered`
- Handle permission requests interactively (`allow once` / `always` / `reject`), from the main agent and from subagents of the followed session
- A permission prompt stays in the chat when it ends: its buttons go and a last line names the outcome — the decision tapped here, the decision made outside Telegram (or just that it was answered there, when OpenCode does not say how), or "not answered" when it was dropped by `/abort`, `/detach`, `/opencode_stop`, a restart of the OpenCode V2 server or the end of the run
- An answer that does not reach OpenCode leaves the prompt answerable with a warning line; tapping again sends it again
- After the event stream reconnects to the same server, prompts and polls on screen that OpenCode no longer has pending are closed as answered (or cancelled) outside Telegram; when the bot cannot tell whether the server restarted, the same line is used
- On OpenCode V2, a poll on screen when the server goes away — `/opencode_stop`, a restart outside the bot, a crash — keeps its question text, loses its buttons and ends with `⏹ Not answered`
- Starting the bot, attaching, `/sessions` and an event-stream reconnect show one prompt per distinct pending permission request (identical ones grouped) and one poll per pending question, however many of them run at once

### Result delivery

- Send each completed assistant response after completion signal from SSE
- When the assistant footer is on, every answered turn of the followed session ends with its own footer — including a turn OpenCode starts by itself after a background command or subagent ends (V2) and a prompt typed in an attached OpenCode TUI or Desktop — with that turn's agent and model and the time from its own start; a turn that is aborted, errors, or is stopped from an attached client gets none
- OpenCode V2 resumes a run interrupted by a server restart (`/opencode_stop` then `/opencode_start`, a restart outside the bot, a crash and auto-restart); the chat ends the interrupted turn as after `/abort` — its tool lines, cards and compact progress end, no footer — and shows the resumed run as a turn OpenCode started by itself, with its own prompts, reply and footer, timed from when the bot saw it again
- In draft streaming mode, assistant text written before a question or permission prompt is sent as a message above that prompt when it appears, and is not sent again when the reply completes
- If that send fails, the reply is not sent again; when Telegram accepts sends again, the chat gets a notice that the last assistant reply was not delivered
- In edit streaming mode the chat reads in the order things happened: a reply the agent wrote before its next tool call, thinking, subagent, document, question or permission prompt sits above it, and the next tool opens a new message (in compact mode, a new progress message) below the reply
- After a mid-session Telegram outage, the next new message is answered without restarting the app
- Compact output mode shows thinking and writing on one progress message per stretch of work between replies and prompts, from the start of that stretch, and a tool call takes it only once its arguments are known; the message is removed or marked finished when the reply or prompt lands, or when the run ends if nothing followed. A message whose stretch started a background operation (OpenCode V2) stays working on that operation with its timer past the reply, prompt or end of the run, and is removed or marked finished with its own counts when its last background operation ends
- In full mode, show every foreground tool operation as soon as its arguments are known, already whole — never as the bare tool name while the agent is still composing the call — without a timer until 20 seconds; edit its line in place as it runs and finishes, keeping parallel operations in start order. A finished call lasting at least 20 seconds shows its total duration. Subagent (`task`) operations use their cards instead of tool lines; a tool delivered as a document loses its running text line when the document arrives. A file-changing tool (`edit`, `write`, `apply_patch`) names each file it changed on its own line with `(+N -M)`, never the patch text, on both OpenCode versions; with diff-file attachments on, each file arrives as its own document captioned with its line, and a file whose diff is over the size limit keeps its text line. A background command or subagent (OpenCode V2) keeps its running line or card, with its timer, after the turn ends and gets its finished line or `✅ Completed` with the total duration when the operation itself ends; after `/abort`, a session switch or a lost event stream it stays as it was. A foreground line whose call ended while the event stream was down also stays as it was; the bot never shows a tool it did not see start
- Show elapsed time for tool calls running longer than 20 seconds, updated on a timer so it keeps counting while a tool blocks without producing output; covers subagent cards and compact mode, and the total duration stays on the finished tool line. In compact mode, while several tools of one step are in flight, the progress line shows the still-running one (the most recently started if several), with that tool's timer — not a finished sibling. A finished subagent card keeps the time its whole run took. Durations use the same `· 🕒 1h 2m 3s` format as the assistant run footer
- A subagent card shows Task, Agent, and Model; when OpenCode sends a variant, the Model line is `provider/id (variant)`
- Render assistant replies with native Telegram formatting: real tables with the column alignment declared in markdown, bullet lists with their nesting, block quotes that keep their nested content, headings, and syntax-highlighted code. Numbered lists and checklists keep literal markers (`1.`, ✅/🔲), because Telegram clients number a native ordered list from zero and do not draw the native checkbox at all
- Deliver reasoning as a collapsed quote that expands on tap
- Hide full model reasoning by default; optionally stream it in the thinking message when explicitly enabled
- Stream intermediate assistant/tool/thinking edits and pinned file-change updates once per second for the first minute, then slow down to 2s / 5s / 10s so long runs stay under Telegram rate limits; the interval resets when the run stops
- Split long responses into multiple Telegram messages, which is now rare: native messages hold 32768 characters instead of 4096
- Send code updates as files (size-limited)

### Session status in chat

- Keep a pinned status message in the chat; it can be turned off in `/settings` (default on)
- Show session title, project, model, context usage, and changed files; when a variant is set, the model line is `provider/id (variant)`
- Auto-update status from SSE and tool events
- Preserve pinned message ID across bot restarts

### Security

- Whitelist by Telegram user ID (single-user mode)
- Ignore messages from non-authorized users
- Ignore updates queued while the bot was offline or unreachable, so they are not executed on startup
- Mid-session, messages older than 60 seconds after an outage are still not executed; the chat gets one notice that messages were skipped while Telegram was unreachable
- If Telegram is unreachable at startup (network error, 5xx, 429), keep retrying with a growing delay capped at 60 seconds until it answers, then start polling; a rejected or invalid token (401/404) or any other fatal startup error logs the cause and exits the process with code 1 so a supervisor can restart it

### Configuration

- Telegram bot token
- Allowed Telegram user ID
- Default model provider and model ID
- OpenCode server API version (`OPENCODE_SERVER_VERSION`: `v1` or `v2`) with a version-dependent default URL; the installed-mode setup wizard asks for it (V2 on a first setup, the saved choice on a re-run) and requires the server password for V2
- Selected project persisted in `settings.json`
- Configurable sessions list size (default: 10)
- Configurable commands list size (default: 10)
- Configurable scheduled task limit (default: 10)
- Configurable bot locale
- Configurable visibility for thinking content and diff-file attachments
- Configurable compact output, assistant footer, pinned session dashboard, message queue, and TTS modes (`/settings`)
- Configurable opt-in display of full thinking/reasoning content
- Configurable max code file size in KB (default: 100)
- Optional STT settings for voice transcription (`STT_API_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`)
- Optional TTS settings for global audio replies (`TTS_PROVIDER`, `TTS_API_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`); supported providers: OpenAI-compatible, ElevenLabs, Google Cloud TTS, and Microsoft Edge TTS (no API key required)
- Optional IPv4-only mode for Telegram connectivity (`TELEGRAM_FORCE_IPV4`)
- Optional loopback health endpoint for Docker and orchestrators (`BOT_HEALTH_PORT`; off by default, `3100` in the Docker image)

## Current Product Scope

### Bot commands

Current command set:

- `/status` - bot version, server, project, and session status
- `/new` - create a new session
- `/abort` - stop the current task
- `/detach` - detach the bot from the current session without stopping it; messages waiting for its running task stay with it and reach it as if the bot had stayed attached (no buttons, withdrawn only by `/abort` there or `/opencode_stop`); a later command or prompt HTTP failure for that session is not posted to chat unless the bot has re-attached to it
- `/sessions` - show and switch recent sessions
- `/recent` - show recent sessions across projects and worktrees with their status and switch directly to one
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
- `/reload` - V2 only: reload the OpenCode configuration (config, plugins, providers and models, agents, commands, skills, MCP) for every loaded project without restarting the server; available during an active request, blocked while an interaction is on screen; the model menu reflects the reloaded providers at once
- `/help` - show command help
- `/ls` - interactive file browser for the current project directory; a text file can be attached to the next prompt from its detail view

Model, agent, variant, and context actions are available from the persistent bottom keyboard. The context button opens window usage and the latest assistant message's token breakdown and cost when a session is idle; its inline controls close the details or open a separate compaction confirmation.

On OpenCode V2, sessions, projects and worktrees whose folder the server reports as no longer existing are left out of `/recent`, `/sessions`, `/projects` and `/worktree`. A current project in such a folder stays selected and named in `/status` and the pinned message; a prompt, `/new` or `/task` there answers that the folder is gone and points to `/projects` (or to `/worktree` for a worktree whose main repository still exists, where `/worktree` then lists that repository's worktrees) instead of reaching OpenCode. A scheduled task in such a folder fails each run with that reason and stays in the list.

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. When TTS mode in `/settings` is set to `all`, completed assistant replies include a generated audio file if TTS is configured. When it is set to `auto`, audio replies are sent only after voice/audio prompts.

Interaction routing rules:

- Only one interactive flow can be active at a time (inline menu, permission, question, rename, commands, skills, messages)
- Agent questions and permission requests are shown one after another: one arriving while another holds the slot waits, and waiting requests appear in the order they arrived; a new question from the session whose poll is on screen replaces it, one from another session (a parallel subagent) waits; `/abort`, `/detach` and `/opencode_stop` drop everything waiting
- While an interaction is active, unrelated input is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/abort`, `/detach`, `/opencode_stop`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/abort`, `/detach`, reset/cleanup)

Model picker behavior:

- Uses OpenCode local model state (`favorite` + `recent`)
- Favorites are shown first, recent models are shown after favorites
- Models already present in favorites are not duplicated in recent
- Default configured model (`OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID`) is treated as favorite
  while OpenCode offers it
- Only models OpenCode currently offers appear in favorites, recent, provider lists and search;
  a provider with no models left is not listed. The bot hides the entry and leaves OpenCode's own
  favorites and recent untouched, so a model shows up again once OpenCode offers it again
- A tap on a model OpenCode no longer offers selects nothing and silently redraws the screen from
  the current list
- A selected model OpenCode no longer offers falls back to the configured model at the next server
  start or `/reload` (in the first minute after a start it is kept until the minute ends); switching
  to a session or picking an agent whose model is no longer offered selects the configured model
  instead. When the configured model is not offered either, the selection stays as it is
- Models can be browsed by provider: the picker offers a providers list and a paginated model
  list per provider, with a back button on each screen (page size: `MODELS_LIST_LIMIT`)
- Picking a model opens the variant picker right after the confirmation when the model offers
  more than one selectable variant; a model with only `Default` ends at the confirmation

Agent picker behavior:

- Picking an agent applies that agent's configured model and/or variant when the agent names
  them; a field the agent does not name is left as it is. This is not a model pick and does
  not open the variant menu

### Main features already implemented

- [x] Single-user access control by allowed Telegram user ID
- [x] OpenCode server control from Telegram (`/status`, `/opencode_start`, `/opencode_stop`)
- [x] OpenCode V1 and V2 servers, selected by `OPENCODE_SERVER_VERSION`; pending questions and permissions come back after the event stream reconnects
- [x] OpenCode V2 set up and started out of the box: the setup wizard asks for the version and the V2 password, and `/opencode_start`, `/opencode_stop` and auto-restart manage the V2 background server
- [x] Project and session management from Telegram (`/projects`, `/worktree`, `/sessions`, `/new`)
- [x] Cross-project recent sessions with status and direct attachment (`/recent`)
- [x] Sessions, projects and worktrees from folders that no longer exist hidden from the lists, with a notice instead of a failed send there (OpenCode V2)
- [x] Automatic tracking of the current OpenCode CLI session, including continuing it from Telegram, live updates, and external text input notifications
- [x] Remote task execution, interruption, and local detachment support (`/abort`, `/detach`)
- [x] Background notifications for detached/non-current sessions in the currently selected project/worktree
- [x] Telegram-friendly result delivery, including sending generated code/files when needed
- [x] Interactive question and permission handling directly in chat (buttons + custom answers)
- [x] Live pinned session status in chat (project, model with variant in parentheses when set, context usage, changed files), with an opt-out in `/settings` that defaults to on
- [x] In-chat controls for model, agent, variant, and context
- [x] Built-in and custom command catalog access (`/commands`)
- [x] Trusted local JSON commands from the persistent application home, executed without OpenCode or model tokens
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
- [x] Optional message queue for text, voice, photos, rich formatted messages with photos, documents, and media groups sent while the agent is busy, managed from the bottom keyboard
- [x] OpenCode V2: messages sent mid-run are steered into the running turn or queued in the session inbox (Off / Queue / Steer in `/settings`), withdrawable until picked up or until `/detach` leaves them to the session
- [x] Native Telegram rich message formatting for assistant replies (Bot API 10.1)
- [x] Incoming Telegram rich formatted messages (Bot API 10.1): converted to Markdown, accepted anywhere text is accepted, with photos attached and unsupported message types answered explicitly
- [x] Startup either reaches Telegram polling or the process exits: transient Telegram failures are retried in-process; a bad token or other fatal startup error exits with code 1
- [x] After a Telegram outage the bot answers again without restart; an undelivered assistant reply is not resent, and skipped stale messages are reported once

## Current Task List

Open tasks for upcoming iterations:

- [ ] Model search in model switcher
- [x] Docker runtime support and deployment guide
- [x] Loopback health endpoint and Docker `HEALTHCHECK`
- [x] Add a bot settings command with in-chat UI
