export const en = {
  "cmd.description.status": "Server and session status",
  "cmd.description.new": "Create a new session",
  "cmd.description.stop": "Stop current action",
  "cmd.description.sessions": "List sessions",
  "cmd.description.tts": "Toggle audio replies",
  "cmd.description.projects": "List projects",
  "cmd.description.worktree": "Switch git worktrees",
  "cmd.description.task": "Create a scheduled task",
  "cmd.description.tasklist": "List scheduled tasks",
  "cmd.description.commands": "Custom commands",
  "cmd.description.skills": "Skills catalog",
  "cmd.description.mcps": "MCP servers",
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

  "interaction.blocked.expired": "⚠️ This interaction has expired. Please start it again.",
  "interaction.blocked.expected_callback":
    "⚠️ Please use the inline buttons for this step or tap Cancel.",
  "interaction.blocked.expected_text": "⚠️ Please send a text message for this step.",
  "interaction.blocked.expected_command": "⚠️ Please send a command for this step.",
  "interaction.blocked.command_not_allowed":
    "⚠️ This command is not available in the current step.",
  "interaction.blocked.finish_current":
    "⚠️ Finish the current interaction first (answer or cancel), then open another menu.",

  "inline.blocked.expected_choice": "⚠️ Choose an option using the inline buttons or tap Cancel.",
  "inline.blocked.command_not_allowed":
    "⚠️ This command is not available while inline menu is active.",

  "question.blocked.expected_answer":
    "⚠️ Answer the current question using buttons, Custom answer, or Cancel.",
  "question.blocked.command_not_allowed":
    "⚠️ This command is not available until current question flow is completed.",

  "inline.button.cancel": "❌ Cancel",
  "inline.inactive_callback": "This menu is inactive",
  "inline.cancelled_callback": "Cancelled",

  "common.unknown": "unknown",
  "common.unknown_error": "unknown error",

  "start.welcome":
    "👋 Welcome to OpenCode Telegram Bot!\n\nUse commands:\n/projects — select project\n/sessions — session list\n/new — new session\n/commands — custom commands\n/skills — skills catalog\n/task — scheduled task\n/tasklist — scheduled tasks\n/status — status\n/help — help\n\nUse the bottom buttons to select the agent, model, and variant.",
  "help.keyboard_hint":
    "💡 Use the bottom keyboard buttons for the agent, model, variant, and context actions.",
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
    "⏳ Agent is already running a task. Wait for completion or use /abort to interrupt current run.",
  "bot.session_reset_project_mismatch":
    "⚠️ Active session does not match the selected project, so it was reset. Use /sessions to pick one or /new to create a new session.",
  "bot.prompt_send_error": "Failed to send request to OpenCode.",
  "bot.session_error": "🔴 OpenCode returned an error: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nProvider keeps returning the same error on repeated retries. Use /abort to abort.",
  "bot.external_user_input": "External user input",
  "bot.unknown_command": "⚠️ Unknown command: {command}. Use /help to see available commands.",
  "bot.photo_downloading": "⏳ Downloading photo...",
  "bot.photo_too_large": "⚠️ Photo is too large (max {maxSizeMb}MB)",
  "bot.photo_model_no_image": "⚠️ Current model doesn't support image input. Sending text only.",
  "bot.photo_download_error": "🔴 Failed to download photo",
  "bot.photo_no_caption": "💡 Tip: Add a caption to describe what you want to do with this photo.",
  "bot.file_downloading": "⏳ Downloading file...",
  "bot.file_too_large": "⚠️ File is too large (max {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 Failed to download file",
  "bot.model_no_pdf": "⚠️ Current model doesn't support PDF input. Sending text only.",
  "bot.text_file_too_large": "⚠️ Text file is too large (max {maxSizeKb}KB)",

  "status.header_running": "🟢 OpenCode Server is running",
  "status.health.healthy": "Healthy",
  "status.health.unhealthy": "Unhealthy",
  "status.line.health": "Status: {health}",
  "status.line.version": "Version: {version}",
  "status.line.managed_yes": "Started by bot: Yes",
  "status.line.managed_no": "Started by bot: No",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Uptime: {seconds} sec",
  "status.line.mode": "Agent: {mode}",
  "status.line.model": "Model: {model}",
  "status.line.tts": "TTS replies: {tts}",
  "status.tts.on": "On",
  "status.tts.off": "Off",
  "status.agent_not_set": "not set",
  "status.project_selected": "Project: {project}",
  "status.worktree_selected": "Worktree: {worktree}",
  "status.project_not_selected": "Project: not selected",
  "status.project_hint": "Use /projects to select a project",
  "status.session_selected": "Current session: {title}",
  "status.session_not_selected": "Current session: not selected",
  "status.session_hint": "Use /sessions to select one or /new to create one",
  "status.server_unavailable":
    "🔴 OpenCode Server is unavailable\n\nUse /opencode_start to start the server.",

  "tts.enabled": "🔊 Audio replies enabled globally.",
  "tts.not_configured":
    "⚠️ Audio replies are unavailable. Set `TTS_API_URL` and `TTS_API_KEY` first.",
  "tts.disabled": "🔇 Audio replies disabled globally.",
  "tts.failed": "⚠️ Failed to generate audio reply.",

  "projects.empty":
    "📭 No projects found.\n\nOpen a directory in OpenCode and create at least one session, then it will appear here.",
  "projects.select": "Select a project:",
  "projects.select_with_current": "Select a project:\n\nCurrent: 🏗 {project}",
  "projects.page_indicator": "Page {current}/{total}",
  "projects.prev_page": "⬅️ Previous",
  "projects.next_page": "Next ➡️",
  "projects.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading projects.",
  "projects.page_load_error": "Cannot load this page. Please try again.",
  "projects.selected":
    "✅ Project selected: {project}\n\n📋 Session was reset. Use /sessions or /new for this project.",
  "projects.select_error": "🔴 Failed to select project.",

  "sessions.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "sessions.empty": "📭 No sessions found.\n\nCreate a new session with /new.",
  "sessions.select": "Select a session:",
  "sessions.select_page": "Select a session (page {page}):",
  "sessions.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading sessions.",
  "sessions.select_project_first": "🔴 Project is not selected. Use /projects.",
  "sessions.page_empty_callback": "No sessions on this page",
  "sessions.page_load_error_callback": "Cannot load this page. Please try again.",
  "sessions.button.prev_page": "⬅️ Prev",
  "sessions.button.next_page": "Next ➡️",
  "sessions.loading_context": "⏳ Loading context and latest messages...",
  "sessions.selected": "✅ Session selected: {title}",
  "sessions.select_error": "🔴 Failed to select session.",
  "sessions.preview.empty": "No recent messages.",
  "sessions.preview.title": "Recent messages:",
  "sessions.preview.you": "You:",
  "sessions.preview.agent": "Agent:",

  "attach.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "attach.session_not_selected":
    "💬 Session is not selected.\n\nFirst choose a session with /sessions.",
  "attach.session_project_mismatch":
    "⚠️ The selected session does not match the current project. Choose the session again via /sessions.",
  "attach.connected": "✅ Connected to session: {title}",
  "attach.already_connected": "ℹ️ Already connected to session: {title}",
  "attach.status.idle_message": "Status: idle. Waiting for new events.",
  "attach.status.busy_message": "Status: busy. New prompts are temporarily blocked.",
  "attach.restored_question": "Recovered a pending question for this session.",
  "attach.restored_permissions": "Recovered pending permission requests: {count}.",
  "attach.disconnect_hint":
    "To disconnect, switch to another session or project.",
  "attach.error": "🔴 Failed to attach to the current session.",

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
    "⚠️ Event stream stopped, but server did not confirm abort.\n\nCheck /status and retry /abort in a few seconds.",
  "stop.warn_maybe_finished": "⚠️ Event stream stopped, but the agent may have already finished.",
  "stop.success": "✅ Agent action interrupted. No more messages from this run will be sent.",
  "stop.warn_still_busy":
    "⚠️ Signal sent, but agent is still busy.\n\nEvent stream is already disabled, so no intermediate messages will be sent.",
  "stop.warn_timeout":
    "⚠️ Abort request timeout.\n\nEvent stream is already disabled, retry /abort in a few seconds.",
  "stop.warn_local_only": "⚠️ Event stream stopped locally, but server-side abort failed.",
  "stop.error": "🔴 Failed to stop action.\n\nEvent stream is stopped, try /abort again.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Server is already running\n\nPID: {pid}\nUptime: {seconds} seconds",
  "opencode_start.already_running_external":
    "✅ OpenCode Server is already running as an external process\n\nVersion: {version}\n\nThis server was not started by bot, so /opencode-stop cannot stop it.",
  "opencode_start.already_running": "✅ OpenCode Server is already running\n\nVersion: {version}",
  "opencode_start.remote_configured": "⚠️ /opencode_start works only with a local OpenCode Server.",
  "opencode_start.starting": "🔄 Starting OpenCode Server...",
  "opencode_start.start_error":
    "🔴 Failed to start OpenCode Server\n\nError: {error}\n\nCheck that OpenCode CLI is installed and available in PATH:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Server started, but is not responding\n\nPID: {pid}\n\nServer may still be starting. Try /status in a few seconds.",
  "opencode_start.success":
    "✅ OpenCode Server started successfully\n\nPID: {pid}\nVersion: {version}",
  "opencode_start.error":
    "🔴 An error occurred while starting server.\n\nCheck application logs for details.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Server is running as an external process\n\nThis server was not started via /opencode-start.\nStop it manually or use /status to check state.",
  "opencode_stop.remote_configured": "⚠️ /opencode_stop works only with a local OpenCode Server.",
  "opencode_stop.not_running": "⚠️ OpenCode Server is not running",
  "opencode_stop.pid_not_found":
    "⚠️ OpenCode Server responds on port {port}, but no local process was found to stop.",
  "opencode_stop.stopping": "🛑 Stopping OpenCode Server...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 Failed to stop OpenCode Server\n\nError: {error}",
  "opencode_stop.still_running": "Server is still responding after the stop request.",
  "opencode_stop.success": "✅ OpenCode Server stopped successfully",
  "opencode_stop.error":
    "🔴 An error occurred while stopping server.\n\nCheck application logs for details.",

  "agent.changed_callback": "Agent changed: {name}",
  "agent.changed_message": "✅ Agent changed to: {name}",
  "agent.change_error_callback": "Failed to change agent",
  "agent.menu.current": "Current agent: {name}\n\nSelect agent:",
  "agent.menu.select": "Select agent:",
  "agent.menu.empty": "⚠️ No available agents",
  "agent.menu.error": "🔴 Failed to get agents list",

  "model.changed_callback": "Model changed: {name}",
  "model.changed_message": "✅ Model changed to: {name}",
  "model.change_error_callback": "Failed to change model",
  "model.menu.empty": "⚠️ No available models",
  "model.menu.select": "Select model:",
  "model.menu.current": "Current model: {name}\n\nSelect model:",
  "model.menu.favorites_title": "⭐ Favorites (Add models to favorites in OpenCode CLI)",
  "model.menu.favorites_empty": "— Empty.",
  "model.menu.recent_title": "🕘 Recent",
  "model.menu.recent_empty": "— Empty.",
  "model.menu.favorites_hint":
    "ℹ️ Add models to favorites in OpenCode CLI to keep them at the top.",
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
  "context.no_active_session": "⚠️ No active session. Create a session with /new",
  "context.confirm_text":
    '📊 Context compaction for session "{title}"\n\nThis will reduce context usage by removing old messages from history. Current task will not be interrupted.\n\nContinue?',
  "context.callback_session_not_found": "Session not found",
  "context.callback_compacting": "Compacting context...",
  "context.progress": "⏳ Compacting context...",
  "context.error": "❌ Context compaction failed",
  "context.success": "✅ Context compacted successfully",

  "permission.inactive_callback": "Permission request is inactive",
  "permission.processing_error_callback": "Processing error",
  "permission.no_active_request_callback": "Error: no active request",
  "permission.reply.once": "Allowed once",
  "permission.reply.always": "Always allowed",
  "permission.reply.reject": "Rejected",
  "permission.send_reply_error": "❌ Failed to send permission reply",
  "permission.blocked.expected_reply":
    "⚠️ Please answer the permission request first using the buttons above.",
  "permission.blocked.command_not_allowed":
    "⚠️ This command is not available until you answer the permission request.",
  "permission.header": "{emoji} Permission request: {name}\n\n",
  "permission.button.allow": "✅ Allow once",
  "permission.button.always": "🔓 Allow always",
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
  "permission.name.external_directory": "External Directory",

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
  "question.multi_hint": "\n(You can select multiple options)",
  "question.button.submit": "✅ Done",
  "question.button.custom": "🔤 Custom answer",
  "question.button.cancel": "❌ Cancel",
  "question.use_custom_button_first":
    '⚠️ To send text, tap "Custom answer" for the current question first.',
  "question.summary.title": "✅ Poll completed!\n\n",
  "question.summary.question": "Question {index}:\n{question}\n\n",
  "question.summary.answer": "Answer:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Agent",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Default",
  "keyboard.updated": "⌨️ Keyboard updated",

  "pinned.default_session_title": "new session",
  "pinned.unknown": "Unknown",
  "pinned.line.project": "Project: {project}",
  "pinned.line.worktree": "Worktree: {worktree}",
  "pinned.line.model": "Model: {model}",
  "pinned.line.attach": "Tracking: {status}",
  "pinned.attach.status.idle": "active, idle",
  "pinned.attach.status.busy": "active, busy",
  "pinned.line.context": "Context: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "Cost: {cost} spent",
  "subagent.header": "Subagent {agent}: {description}",
  "subagent.line.status": "Status: {status}",
  "subagent.line.task": "Task: {task}",
  "subagent.line.agent": "Agent: {agent}",
  "subagent.working": "Working...",
  "subagent.working_with_details": "Working: {details}",
  "subagent.completed": "Completed",
  "subagent.failed": "Task failed",
  "subagent.status.pending": "pending",
  "subagent.status.running": "running",
  "subagent.status.completed": "completed",
  "subagent.status.error": "error",
  "pinned.files.title": "Files ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... and {count} more",

  "tool.todo.overflow": "*({count} more tasks)*",
  "tool.file_header.write":
    "Write File/Path: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Edit File/Path: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Enter Telegram bot token (get it from @BotFather).\n> ",
  "runtime.wizard.ask_language":
    "Select interface language.\nEnter the language number from the list or locale code.\nPress Enter to keep default language: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Enter a language number from the list or a supported locale code.\n",
  "runtime.wizard.language_selected": "Selected language: {language}\n",
  "runtime.wizard.token_required": "Token is required. Please try again.\n",
  "runtime.wizard.token_invalid":
    "Token looks invalid (expected format <id>:<secret>). Please try again.\n",
  "runtime.wizard.ask_user_id":
    "Enter your Telegram User ID (you can get it from @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Enter a positive integer (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Enter OpenCode API URL (optional).\nPress Enter to use default: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "Enter OpenCode server username (optional).\nPress Enter to use default: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "Enter OpenCode server password (optional).\nPress Enter to keep it empty.\n> ",
  "runtime.wizard.api_url_invalid": "Enter a valid URL (http/https) or press Enter for default.\n",
  "runtime.wizard.start": "OpenCode Telegram Bot setup.\n",
  "runtime.wizard.saved": "Configuration saved:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Application is not configured yet. Starting wizard...\n",
  "runtime.wizard.tty_required":
    "Interactive wizard requires a TTY terminal. Run `opencode-telegram config` in an interactive shell.",

  "rename.no_session": "⚠️ No active session. Create or select a session first.",
  "rename.prompt": "📝 Enter new title for session:\n\nCurrent: {title}",
  "rename.empty_title": "⚠️ Title cannot be empty.",
  "rename.success": "✅ Session renamed to: {title}",
  "rename.error": "🔴 Failed to rename session.",
  "rename.cancelled": "❌ Rename cancelled.",
  "rename.inactive_callback": "Rename request is inactive",
  "rename.inactive": "⚠️ Rename request is not active. Run /rename again.",
  "rename.blocked.expected_name":
    "⚠️ Enter a new session name as text or tap Cancel in rename message.",
  "rename.blocked.command_not_allowed":
    "⚠️ This command is not available while rename is waiting for a new name.",
  "rename.button.cancel": "❌ Cancel",

  "task.prompt.schedule":
    "⏰ Send the task schedule in natural language.\n\nExamples:\n- every 5 minutes\n- every day at 17:00\n- tomorrow at 12:00",
  "task.schedule_empty": "⚠️ Schedule cannot be empty.",
  "task.parse.in_progress": "⏳ Parsing schedule...",
  "task.parse_error":
    "🔴 Failed to parse schedule.\n\n{message}\n\nSend the schedule again in a clearer form.",
  "task.schedule_preview":
    "✅ Schedule parsed\n\nHow I understood it: {summary}\n{cronLine}Timezone: {timezone}\nType: {kind}\nNext run: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 Now send what the bot should do on schedule.",
  "task.prompt_empty": "⚠️ Task text cannot be empty.",
  "task.created":
    "✅ Scheduled task created\n\nTask: {description}\nProject: {project}\nModel: {model}\nSchedule: {schedule}\n{cronLine}Next run: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 Re-enter schedule",
  "task.button.cancel": "❌ Cancel",
  "task.retry_schedule_callback": "Re-entering schedule...",
  "task.cancel_callback": "Cancelling...",
  "task.cancelled": "❌ Scheduled task creation cancelled.",
  "task.inactive_callback": "This scheduled task flow is inactive",
  "task.inactive": "⚠️ Scheduled task creation is not active. Run /task again.",
  "task.blocked.expected_input":
    "⚠️ Finish the current scheduled task setup first by sending text or using the button in the schedule message.",
  "task.blocked.command_not_allowed":
    "⚠️ This command is not available while scheduled task creation is active.",
  "task.limit_reached": "⚠️ Task limit reached ({limit}). Delete an existing scheduled task first.",
  "task.schedule_too_frequent":
    "Recurring schedule is too frequent. The minimum allowed interval is once every 5 minutes.",
  "task.kind.cron": "recurring",
  "task.kind.once": "one-time",
  "task.run.success": "⏰ Scheduled task completed: {description}",
  "task.run.error": "🔴 Scheduled task failed: {description}\n\nError: {error}",
  "task.run.error.interactive_question":
    "Scheduled task requested an interactive question and cannot continue unattended.",
  "task.run.error.interactive_permission":
    "Scheduled task requested interactive permission and cannot continue unattended.",

  "tasklist.empty": "📭 No scheduled tasks yet.",
  "tasklist.select": "Select a scheduled task:",
  "tasklist.details":
    "⏰ Scheduled task\n\nTask: {prompt}\nProject: {project}\nSchedule: {schedule}\n{cronLine}Timezone: {timezone}\nNext run: {nextRunAt}\nLast run: {lastRunAt}\nRun count: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 Delete",
  "tasklist.button.cancel": "❌ Cancel",
  "tasklist.deleted_callback": "Deleted",
  "tasklist.cancelled_callback": "Cancelled",
  "tasklist.inactive_callback": "This scheduled task menu is inactive",
  "tasklist.load_error": "🔴 Failed to load scheduled tasks.",

  "commands.select": "Choose an OpenCode command:",
  "commands.empty": "📭 No OpenCode commands are available for this project.",
  "commands.fetch_error": "🔴 Failed to load OpenCode commands.",
  "commands.no_description": "No description",
  "commands.button.execute": "✅ Execute",
  "commands.button.cancel": "❌ Cancel",
  "commands.confirm":
    "Confirm execution of command {command}. To run it with arguments, send the arguments as a message.",
  "commands.inactive_callback": "This command menu is inactive",
  "commands.cancelled_callback": "Cancelled",
  "commands.execute_callback": "Executing command...",
  "commands.executing_prefix": "⚡ Executing command:",
  "commands.arguments_empty": "⚠️ Arguments cannot be empty. Send text or tap Execute.",
  "commands.execute_error": "🔴 Failed to execute OpenCode command.",
  "commands.select_page": "Choose an OpenCode command (page {page}):",
  "commands.button.prev_page": "⬅️ Prev",
  "commands.button.next_page": "Next ➡️",
  "commands.page_empty_callback": "No commands on this page",
  "commands.page_load_error_callback": "Cannot load this page. Please try again.",

  "skills.select": "Choose an OpenCode skill:",
  "skills.empty": "📭 No OpenCode skills are available for this project.",
  "skills.fetch_error": "🔴 Failed to load OpenCode skills.",
  "skills.no_description": "No description",
  "skills.button.execute": "✅ Execute",
  "skills.button.cancel": "❌ Cancel",
  "skills.confirm":
    "Confirm execution of skill {skill}. To run it with arguments, send the arguments as a message.",
  "skills.inactive_callback": "This skill menu is inactive",
  "skills.cancelled_callback": "Cancelled",
  "skills.execute_callback": "Using skill...",
  "skills.executing_prefix": "⚡ Using skill:",
  "skills.arguments_empty": "⚠️ Arguments cannot be empty. Send text or tap Execute.",
  "skills.select_page": "Choose an OpenCode skill (page {page}):",
  "skills.button.prev_page": "⬅️ Prev",
  "skills.button.next_page": "Next ➡️",
  "skills.page_empty_callback": "No skills on this page",
  "skills.page_load_error_callback": "Cannot load this page. Please try again.",

  "mcps.select": "MCP servers:",
  "mcps.empty": "📭 No MCP servers configured.",
  "mcps.fetch_error": "🔴 Failed to load MCP servers.",
  "mcps.toggle_error": "🔴 Failed to toggle MCP server.",
  "mcps.enabling": "Enabling...",
  "mcps.disabling": "Disabling...",
  "mcps.status.connected": "🟢 Connected",
  "mcps.status.disabled": "🔴 Disabled",
  "mcps.status.failed": "⚠️ Failed",
  "mcps.status.needs_auth": "🔒 Needs auth",
  "mcps.status.needs_client_registration": "🔒 Needs registration",
  "mcps.detail.title": "Server: {name}",
  "mcps.detail.status": "Status: {status}",
  "mcps.detail.error": "Error: {error}",
  "mcps.button.enable": "🟢 Enable",
  "mcps.button.disable": "🔴 Disable",
  "mcps.button.back": "⬅️ Back",
  "mcps.auth_required": "This server requires authorization and cannot be enabled from the bot.",

  "cmd.description.rename": "Rename current session",

  "legacy.models.fetch_error": "🔴 Failed to get models list. Check server status with /status.",
  "legacy.models.empty": "📋 No available models. Configure providers in OpenCode.",
  "legacy.models.header": "📋 Available models:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ No available models\n",
  "legacy.models.env_hint": "💡 To use model in .env:\n",
  "legacy.models.error": "🔴 An error occurred while loading models list.",

  "stt.recognizing": "🎤 Recognizing audio...",
  "stt.recognized": "🎤 Recognized:\n{text}",
  "stt.not_configured":
    "🎤 Voice recognition is not configured.\n\nSet STT_API_URL and STT_API_KEY in .env to enable it.",
  "stt.error": "🔴 Failed to recognize audio: {error}",
  "stt.empty_result": "🎤 No speech detected in the audio message.",

  "cmd.description.open": "Add a project by browsing directories",
  "worktree.branch_detached": "detached HEAD",
  "worktree.select_with_current": "Select a worktree:",
  "worktree.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "worktree.not_git_repo":
    "🌿 Git worktrees are unavailable for the current project. Select a git repository first.",
  "worktree.not_git_repo_callback": "Current project is not a git repository",
  "worktree.empty": "📭 No git worktrees found for the current repository.",
  "worktree.fetch_error": "🔴 Failed to load git worktrees.",
  "worktree.page_empty_callback": "No worktrees on this page",
  "worktree.selection_missing_callback": "Selected worktree is no longer available",
  "worktree.already_selected_callback": "This worktree is already selected",
  "worktree.selected":
    "✅ Worktree selected: {worktree}\n\n📋 Session was reset. Use /sessions or /new to continue.",
  "worktree.select_error": "🔴 Failed to select worktree.",
  "open.back": "⬆️ Up",
  "open.roots": "📋 Back to roots",
  "open.prev_page": "⬅️ Previous",
  "open.next_page": "Next ➡️",
  "open.select_current": "✅ Select this folder",
  "open.select_root": "📂 Select a root directory to browse:",
  "open.access_denied": "⛔ Access denied: path is outside allowed roots",
  "open.scan_error": "🔴 Cannot browse directory: {error}",
  "open.open_error": "🔴 Failed to open directory browser.",
  "open.selected": "✅ Project added: {project}\n\n📋 Use /sessions or /new to start working.",
  "open.select_error": "🔴 Failed to add project.",
  "open.no_subfolders": "📭 No subfolders",
  "open.subfolder_count": "{count} subfolder",
  "open.subfolders_count": "{count} subfolders",

  "cmd.description.session_delete": "Delete sessions",

  "session_delete.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "session_delete.empty": "📭 No sessions found.\n\nCreate a new session with /new.",
  "session_delete.select": "Select a session to delete:",
  "session_delete.select_page": "Select a session to delete (page {page}):",
  "session_delete.button.delete": "🗑 Delete",
  "session_delete.button.cancel": "❌ Cancel",
  "session_delete.button.prev_page": "⬅️ Prev",
  "session_delete.button.next_page": "Next ➡️",
  "session_delete.details":
    "Session: {title}\nDirectory: {directory}\nCreated: {date}\n\nDelete this session?",
  "session_delete.deleted": "🗑 Session deleted: {title}",
  "session_delete.deleted_current":
    "🗑 Deleted current session: {title}\n\nUse /sessions or /new to continue.",
  "session_delete.cancelled_callback": "Cancelled",
  "session_delete.inactive_callback": "This menu is inactive",
  "session_delete.load_error": "🔴 Failed to load sessions.",
  "session_delete.delete_error": "🔴 Failed to delete session.",
  "session_delete.page_empty_callback": "No sessions on this page",
  "session_delete.page_load_error_callback": "Cannot load this page. Please try again.",
} as const;

export type I18nKey = keyof typeof en;
export type I18nDictionary = Record<I18nKey, string>;
