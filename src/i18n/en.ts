export const en = {
  "cmd.description.status": "Server and session status",
  "cmd.description.new": "Create a new session",
  "cmd.description.stop": "Stop current action",
  "cmd.description.sessions": "List sessions",
  "cmd.description.projects": "List projects",
  "cmd.description.model": "Select model",
  "cmd.description.agent": "Select mode",
  "cmd.description.opencode_start": "Start OpenCode server",
  "cmd.description.opencode_stop": "Stop OpenCode server",
  "cmd.description.help": "Help",

  "callback.unknown_command": "Unknown command",
  "callback.processing_error": "Processing error",

  "error.load_agents": "❌ Failed to load agents list",
  "error.load_models": "❌ Failed to load models list",
  "error.load_variants": "❌ Failed to load variants list",
  "error.context_button": "❌ Failed to process context button",
  "error.generic": "🔴 Something went wrong.",

  "common.unknown": "unknown",
  "common.unknown_error": "unknown error",

  "start.welcome":
    "👋 Welcome to OpenCode Telegram Bot!\n\nUse commands:\n/projects — select project\n/sessions — session list\n/new — new session\n/agent — switch mode\n/model — select model\n/status — status\n/help — help",
  "help.text":
    "📖 **Help**\n\n/status - Check server status\n/sessions - Session list\n/new - Create new session\n/help - Help",

  "bot.thinking": "💭 Thinking...",
  "bot.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "bot.creating_session": "🔄 Creating a new session...",
  "bot.create_session_error":
    "🔴 Failed to create session. Try /new or check server status with /status.",
  "bot.session_created": "✅ Session created: {title}",
  "bot.session_busy":
    "⏳ Agent is already running a task. Wait for completion or use /stop to interrupt current run.",
  "bot.prompt_send_error_detailed": "🔴 Failed to send request.\n\nDetails: {details}",
  "bot.prompt_send_error": "🔴 An error occurred while sending request to OpenCode.",

  "status.header_running": "🟢 **OpenCode Server is running**",
  "status.health.healthy": "Healthy",
  "status.health.unhealthy": "Unhealthy",
  "status.line.health": "Status: {health}",
  "status.line.version": "Version: {version}",
  "status.line.managed_yes": "Managed by bot: Yes",
  "status.line.managed_no": "Managed by bot: No",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Uptime: {seconds} sec",
  "status.line.mode": "Mode: {mode}",
  "status.line.model": "Model: {model}",
  "status.agent_not_set": "not set",
  "status.project_selected": "🏗 Project: {project}",
  "status.project_not_selected": "🏗 Project: not selected",
  "status.project_hint": "Use /projects to select a project",
  "status.session_selected": "📋 Current session: {title}",
  "status.session_not_selected": "📋 Current session: not selected",
  "status.session_hint": "Use /sessions to select one or /new to create one",
  "status.server_unavailable":
    "🔴 OpenCode Server is unavailable\n\nUse /opencode_start to start the server.",

  "projects.empty": "📭 No projects found.",
  "projects.select": "Select a project:",
  "projects.select_with_current": "Select a project:\n\nCurrent: 🏗 {project}",
  "projects.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading projects.",
  "projects.selected":
    "✅ Project selected: {project}\n\n📋 Session was reset. Use /sessions or /new for this project.",
  "projects.select_error": "🔴 Failed to select project.",

  "sessions.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "sessions.empty": "📭 No sessions found.\n\nCreate a new session with /new.",
  "sessions.select": "Select a session:",
  "sessions.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading sessions.",
  "sessions.select_project_first": "🔴 Project is not selected. Use /projects.",
  "sessions.loading_context": "⏳ Loading context and latest messages...",
  "sessions.selected": "✅ Session selected: {title}",
  "sessions.select_error": "🔴 Failed to select session.",
  "sessions.preview.empty": "No recent messages.",
  "sessions.preview.title": "Recent messages:",
  "sessions.preview.you": "You:",
  "sessions.preview.agent": "Agent:",

  "new.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "new.created": "✅ New session created: {title}",
  "new.create_error":
    "🔴 OpenCode Server is unavailable or an error occurred while creating session.",

  "stop.no_active_session":
    "🛑 Agent was not started\n\nCreate a session with /new or select one via /sessions.",
  "stop.in_progress":
    "🛑 Event stream stopped, sending abort signal...\n\nWaiting for agent to stop.",
  "stop.warn_unconfirmed":
    "⚠️ Event stream stopped, but server did not confirm abort.\n\nCheck /status and retry /stop in a few seconds.",
  "stop.warn_maybe_finished": "⚠️ Event stream stopped, but the agent may have already finished.",
  "stop.success": "✅ Agent action interrupted. No more messages from this run will be sent.",
  "stop.warn_still_busy":
    "⚠️ Signal sent, but agent is still busy.\n\nEvent stream is already disabled, so no intermediate messages will be sent.",
  "stop.warn_timeout":
    "⚠️ Abort request timeout.\n\nEvent stream is already disabled, retry /stop in a few seconds.",
  "stop.warn_local_only": "⚠️ Event stream stopped locally, but server-side abort failed.",
  "stop.error": "🔴 Failed to stop action.\n\nEvent stream is stopped, try /stop again.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Server is already running\n\nPID: {pid}\nUptime: {seconds} seconds",
  "opencode_start.already_running_external":
    "✅ OpenCode Server is already running as an external process\n\nVersion: {version}\n\nThis server was not started by bot, so /opencode-stop cannot stop it.",
  "opencode_start.starting": "🔄 Starting OpenCode Server...",
  "opencode_start.start_error":
    "🔴 Failed to start OpenCode Server\n\nError: {error}\n\nCheck that OpenCode CLI is installed and available in PATH:\n`opencode --version`\n`npm install -g @opencode-ai/cli`",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Server started, but is not responding\n\nPID: {pid}\n\nServer may still be starting. Try /status in a few seconds.",
  "opencode_start.success":
    "✅ OpenCode Server started successfully\n\nPID: {pid}\nVersion: {version}",
  "opencode_start.error":
    "🔴 An error occurred while starting server.\n\nCheck application logs for details.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Server is running as an external process\n\nThis server was not started via /opencode-start.\nStop it manually or use /status to check state.",
  "opencode_stop.not_running": "⚠️ OpenCode Server is not running",
  "opencode_stop.stopping": "🛑 Stopping OpenCode Server...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 Failed to stop OpenCode Server\n\nError: {error}",
  "opencode_stop.success": "✅ OpenCode Server stopped successfully",
  "opencode_stop.error":
    "🔴 An error occurred while stopping server.\n\nCheck application logs for details.",

  "agent.changed_callback": "Mode changed: {name}",
  "agent.changed_message": "✅ Mode changed to: {name}",
  "agent.change_error_callback": "Failed to change mode",
  "agent.menu.current": "Current mode: {name}\n\nSelect mode:",
  "agent.menu.select": "Select work mode:",

  "model.changed_callback": "Model changed: {name}",
  "model.changed_message": "✅ Model changed to: {name}",
  "model.change_error_callback": "Failed to change model",
  "model.menu.empty": "⚠️ No available models",
  "model.menu.current": "Current model: {name}\n\nSelect model:",
  "model.menu.error": "🔴 Failed to get models list",

  "variant.model_not_selected_callback": "Error: model is not selected",
  "variant.changed_callback": "Variant changed: {name}",
  "variant.changed_message": "✅ Variant changed to: {name}",
  "variant.change_error_callback": "Failed to change variant",
  "variant.select_model_first": "⚠️ Select a model first",
  "variant.menu.empty": "⚠️ No available variants",
  "variant.menu.current": "Current variant: {name}\n\nSelect variant:",
  "variant.menu.error": "🔴 Failed to get variants list",

  "context.button.confirm": "✅ Yes, compact context",
  "context.button.cancel": "❌ Cancel",
  "context.no_active_session": "⚠️ No active session. Create a session with /new",
  "context.confirm_text":
    '📊 Context compaction for session "{title}"\n\nThis will reduce context usage by removing old messages from history. Current task will not be interrupted.\n\nContinue?',
  "context.callback_session_not_found": "Session not found",
  "context.callback_compacting": "Compacting context...",
  "context.progress": "⏳ Compacting context...",
  "context.error": "❌ Context compaction failed",
  "context.success": "✅ Context compacted successfully",
  "context.callback_cancelled": "Cancelled",

  "permission.inactive_callback": "Permission request is inactive",
  "permission.processing_error_callback": "Processing error",
  "permission.no_active_request_callback": "Error: no active request",
  "permission.reply.once": "Allowed once",
  "permission.reply.always": "Always allowed",
  "permission.reply.reject": "Rejected",
  "permission.send_reply_error": "❌ Failed to send permission reply",
  "permission.header": "{emoji} **Permission request: {name}**\n\n",
  "permission.button.allow": "✅ Allow",
  "permission.button.always": "🔓 Always",
  "permission.button.reject": "❌ Reject",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Edit",
  "permission.name.write": "Write",
  "permission.name.read": "Read",
  "permission.name.webfetch": "Web Fetch",
  "permission.name.websearch": "Web Search",
  "permission.name.glob": "File Search",
  "permission.name.grep": "Content Search",
  "permission.name.list": "List Directory",
  "permission.name.task": "Task",
  "permission.name.lsp": "LSP",

  "question.inactive_callback": "Poll is inactive",
  "question.processing_error_callback": "Processing error",
  "question.select_one_required_callback": "Select at least one option",
  "question.enter_custom_callback": "Send your custom answer as a message",
  "question.cancelled": "❌ Poll cancelled",
  "question.answer_already_received": "Answer already received, please wait...",
  "question.completed_no_answers": "✅ Poll completed (no answers)",
  "question.no_active_project": "❌ No active project",
  "question.no_active_request": "❌ No active request",
  "question.send_answers_error": "❌ Failed to send answers to agent",
  "question.multi_hint": "\n*You can select multiple options*",
  "question.button.submit": "✅ Done",
  "question.button.custom": "🔤 Custom answer",
  "question.button.cancel": "❌ Cancel",
  "question.summary.title": "✅ Poll completed!\n\n",
  "question.summary.question": "Question {index}:\n{question}\n\n",
  "question.summary.answer": "Answer:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Mode",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Default",
  "keyboard.updated": "⌨️ Keyboard updated",

  "pinned.default_session_title": "new session",
  "pinned.unknown": "Unknown",
  "pinned.line.project": "Project: {project}",
  "pinned.line.model": "Model: {model}",
  "pinned.line.context": "Context: {used} / {limit} ({percent}%)",
  "pinned.files.title": "Files ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... and {count} more",

  "tool.todo.overflow": "*({count} more tasks)*",
  "tool.file_header.write":
    "Write File/Path: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Edit File/Path: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Enter Telegram bot token (get it from @BotFather).\n> ",
  "runtime.wizard.token_required": "Token is required. Please try again.\n",
  "runtime.wizard.token_invalid":
    "Token looks invalid (expected format <id>:<secret>). Please try again.\n",
  "runtime.wizard.ask_user_id":
    "Enter your Telegram User ID (you can get it from @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Enter a positive integer (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Enter OpenCode API URL (optional).\nPress Enter to use default: {defaultUrl}\n> ",
  "runtime.wizard.api_url_invalid": "Enter a valid URL (http/https) or press Enter for default.\n",
  "runtime.wizard.start": "Starting first-run wizard for OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Configuration saved:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Application is not configured yet. Starting wizard...\n",
  "runtime.wizard.tty_required":
    "Interactive wizard requires a TTY terminal. Run `opencode-telegram config` in an interactive shell.",
  "runtime.wizard.server_auth_header": "--- Server Authentication (optional) ---",
  "runtime.wizard.ask_server_username":
    "Enter OpenCode server username (optional, press Enter for default: opencode).\n> ",
  "runtime.wizard.ask_server_password":
    "Enter OpenCode server password (optional, press Enter to skip).\n> ",

  "cli.usage":
    "Usage:\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nNotes:\n  - No command defaults to `start`\n  - `--mode` is currently supported for `start` only",
  "cli.placeholder.status":
    "Command `status` is currently a placeholder. Real status checks will be added in service layer (Phase 5).",
  "cli.placeholder.stop":
    "Command `stop` is currently a placeholder. Real background process stop will be added in service layer (Phase 5).",
  "cli.placeholder.unavailable": "Command is unavailable.",
  "cli.error.prefix": "CLI error: {message}",
  "cli.args.unknown_command": "Unknown command: {value}",
  "cli.args.mode_requires_value": "Option --mode requires a value: sources|installed",
  "cli.args.invalid_mode": "Invalid mode value: {value}. Expected sources|installed",
  "cli.args.unknown_option": "Unknown option: {value}",
  "cli.args.mode_only_start": "Option --mode is supported only for the start command",

  "legacy.models.fetch_error": "🔴 Failed to get models list. Check server status with /status.",
  "legacy.models.empty": "📋 No available models. Configure providers in OpenCode.",
  "legacy.models.header": "📋 **Available models:**\n\n",
  "legacy.models.no_provider_models": "  ⚠️ No available models\n",
  "legacy.models.env_hint": "💡 To use model in .env:\n",
  "legacy.models.error": "🔴 An error occurred while loading models list.",
} as const;

export type I18nKey = keyof typeof en;
export type I18nDictionary = Record<I18nKey, string>;
