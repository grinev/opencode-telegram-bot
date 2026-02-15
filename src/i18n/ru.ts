import type { I18nDictionary } from "./en.js";

export const ru: I18nDictionary = {
  "cmd.description.status": "Статус сервера и сессии",
  "cmd.description.new": "Создать новую сессию",
  "cmd.description.stop": "Прервать текущее действие",
  "cmd.description.sessions": "Список сессий",
  "cmd.description.projects": "Список проектов",
  "cmd.description.model": "Выбрать модель",
  "cmd.description.agent": "Выбрать режим работы",
  "cmd.description.opencode_start": "Запустить OpenCode сервер",
  "cmd.description.opencode_stop": "Остановить OpenCode сервер",
  "cmd.description.help": "Справка",

  "callback.unknown_command": "Неизвестная команда",
  "callback.processing_error": "Ошибка обработки",

  "error.load_agents": "❌ Ошибка при загрузке списка агентов",
  "error.load_models": "❌ Ошибка при загрузке списка моделей",
  "error.load_variants": "❌ Ошибка при загрузке списка вариантов",
  "error.context_button": "❌ Ошибка при обработке кнопки контекста",
  "error.generic": "🔴 Произошла ошибка.",

  "common.unknown": "неизвестна",
  "common.unknown_error": "неизвестная ошибка",

  "start.welcome":
    "👋 Добро пожаловать в OpenCode Telegram Bot!\n\nИспользуйте команды:\n/projects — выбрать проект\n/sessions — список сессий\n/new — новая сессия\n/agent — сменить режим\n/model — выбрать модель\n/status — статус\n/help — справка",
  "help.text":
    "📖 **Справка**\n\n/status - Проверить статус сервера\n/sessions - Список сессий\n/new - Создать новую сессию\n/help - Справка",

  "bot.thinking": "💭 Думаю...",
  "bot.project_not_selected": "🏗 Проект не выбран.\n\nСначала выберите проект командой /projects.",
  "bot.creating_session": "🔄 Создаю новую сессию...",
  "bot.create_session_error":
    "🔴 Не удалось создать сессию. Попробуйте команду /new или проверьте статус сервера /status.",
  "bot.session_created": "✅ Сессия создана: {title}",
  "bot.session_busy":
    "⏳ Агент уже выполняет задачу. Дождитесь завершения или используйте /stop, чтобы прервать текущий запуск.",
  "bot.prompt_send_error_detailed": "🔴 Ошибка при отправке запроса.\n\nДетали: {details}",
  "bot.prompt_send_error": "🔴 Произошла ошибка при отправке запроса в OpenCode.",

  "status.header_running": "🟢 **OpenCode Server запущен**",
  "status.health.healthy": "Healthy",
  "status.health.unhealthy": "Unhealthy",
  "status.line.health": "Статус: {health}",
  "status.line.version": "Версия: {version}",
  "status.line.managed_yes": "Управляется ботом: Да",
  "status.line.managed_no": "Управляется ботом: Нет",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Uptime: {seconds} сек",
  "status.line.mode": "Режим: {mode}",
  "status.line.model": "Модель: {model}",
  "status.agent_not_set": "не установлен",
  "status.project_selected": "🏗 Проект: {project}",
  "status.project_not_selected": "🏗 Проект: не выбран",
  "status.project_hint": "Используйте /projects для выбора проекта",
  "status.session_selected": "📋 Текущая сессия: {title}",
  "status.session_not_selected": "📋 Текущая сессия: не выбрана",
  "status.session_hint": "Используйте /sessions для выбора или /new для создания",
  "status.server_unavailable":
    "🔴 OpenCode Server недоступен\n\nИспользуйте /opencode_start для запуска сервера.",

  "projects.empty": "📭 Проектов нет.",
  "projects.select": "Выберите проект:",
  "projects.select_with_current": "Выберите проект:\n\nТекущий: 🏗 {project}",
  "projects.fetch_error":
    "🔴 OpenCode Server недоступен или произошла ошибка при получении списка проектов.",
  "projects.selected":
    "✅ Проект выбран: {project}\n\n📋 Сессия сброшена. Используйте /sessions или /new для работы с этим проектом.",
  "projects.select_error": "🔴 Ошибка при выборе проекта.",

  "sessions.project_not_selected":
    "🏗 Проект не выбран.\n\nСначала выберите проект командой /projects.",
  "sessions.empty": "📭 Сессий нет.\n\nСоздайте новую сессию командой /new.",
  "sessions.select": "Выберите сессию:",
  "sessions.fetch_error":
    "🔴 OpenCode Server недоступен или произошла ошибка при получении списка сессий.",
  "sessions.select_project_first": "🔴 Проект не выбран. Используйте /projects.",
  "sessions.loading_context": "⏳ Загружаю контекст и последние сообщения...",
  "sessions.selected": "✅ Сессия выбрана: {title}",
  "sessions.select_error": "🔴 Ошибка при выборе сессии.",
  "sessions.preview.empty": "Последних сообщений нет.",
  "sessions.preview.title": "Последние сообщения:",
  "sessions.preview.you": "Вы:",
  "sessions.preview.agent": "Агент:",

  "new.project_not_selected": "🏗 Проект не выбран.\n\nСначала выберите проект командой /projects.",
  "new.created": "✅ Создана новая сессия: {title}",
  "new.create_error": "🔴 OpenCode Server недоступен или произошла ошибка при создании сессии.",

  "stop.no_active_session":
    "🛑 Агент не был запущен\n\nСначала создайте сессию командой /new или выберите существующую через /sessions.",
  "stop.in_progress":
    "🛑 Отключил поток событий и отправляю сигнал прерывания...\n\nОжидание остановки агента.",
  "stop.warn_unconfirmed":
    "⚠️ Поток событий остановлен, но сервер не подтвердил прерывание.\n\nПроверьте /status и повторите /stop через пару секунд.",
  "stop.warn_maybe_finished":
    "⚠️ Поток событий остановлен, но агент мог уже завершиться к моменту запроса.",
  "stop.success":
    "✅ Действие агента прервано. Новые сообщения от текущего запуска больше не придут.",
  "stop.warn_still_busy":
    "⚠️ Сигнал отправлен, но агент еще busy.\n\nПоток событий уже отключен, поэтому бот не будет присылать промежуточные сообщения.",
  "stop.warn_timeout":
    "⚠️ Таймаут запроса на прерывание.\n\nПоток событий уже отключен, повторите /stop через пару секунд.",
  "stop.warn_local_only":
    "⚠️ Поток событий остановлен локально, но при прерывании на сервере произошла ошибка.",
  "stop.error":
    "🔴 Ошибка при прерывании действия.\n\nПоток событий остановлен, попробуйте /stop еще раз.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Server уже запущен\n\nPID: {pid}\nUptime: {seconds} секунд",
  "opencode_start.already_running_external":
    "✅ OpenCode Server уже запущен внешним процессом\n\nВерсия: {version}\n\nЭтот сервер не был запущен через бота, поэтому команда /opencode-stop не сможет его остановить.",
  "opencode_start.starting": "🔄 Запускаю OpenCode Server...",
  "opencode_start.start_error":
    "🔴 Не удалось запустить OpenCode Server\n\nОшибка: {error}\n\nПроверьте, что OpenCode CLI установлен и доступен в PATH:\n`opencode --version`\n`npm install -g @opencode-ai/cli`",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Server запущен, но не отвечает\n\nPID: {pid}\n\nСервер может запускаться. Попробуйте /status через несколько секунд.",
  "opencode_start.success": "✅ OpenCode Server успешно запущен\n\nPID: {pid}\nВерсия: {version}",
  "opencode_start.error":
    "🔴 Произошла ошибка при запуске сервера.\n\nПроверьте логи приложения для подробностей.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Server запущен внешним процессом\n\nЭтот сервер не был запущен через /opencode-start.\nОстановите его вручную или используйте /status для проверки состояния.",
  "opencode_stop.not_running": "⚠️ OpenCode Server не запущен",
  "opencode_stop.stopping": "🛑 Останавливаю OpenCode Server...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 Не удалось остановить OpenCode Server\n\nОшибка: {error}",
  "opencode_stop.success": "✅ OpenCode Server успешно остановлен",
  "opencode_stop.error":
    "🔴 Произошла ошибка при остановке сервера.\n\nПроверьте логи приложения для подробностей.",

  "agent.changed_callback": "Режим изменен: {name}",
  "agent.changed_message": "✅ Режим изменен на: {name}",
  "agent.change_error_callback": "Ошибка при смене режима",
  "agent.menu.current": "Текущий режим: {name}\n\nВыберите режим:",
  "agent.menu.select": "Выберите режим работы:",

  "model.changed_callback": "Модель изменена: {name}",
  "model.changed_message": "✅ Модель изменена на: {name}",
  "model.change_error_callback": "Ошибка при смене модели",
  "model.menu.empty": "⚠️ Нет доступных моделей",
  "model.menu.current": "Текущая модель: {name}\n\nВыберите модель:",
  "model.menu.error": "🔴 Не удалось получить список моделей",

  "variant.model_not_selected_callback": "Ошибка: модель не выбрана",
  "variant.changed_callback": "Variant изменен: {name}",
  "variant.changed_message": "✅ Variant изменен на: {name}",
  "variant.change_error_callback": "Ошибка при смене variant",
  "variant.select_model_first": "⚠️ Сначала выберите модель",
  "variant.menu.empty": "⚠️ Нет доступных вариантов",
  "variant.menu.current": "Текущий variant: {name}\n\nВыберите variant:",
  "variant.menu.error": "🔴 Не удалось получить список вариантов",

  "context.button.confirm": "✅ Да, сжать контекст",
  "context.button.cancel": "❌ Отмена",
  "context.no_active_session": "⚠️ Нет активной сессии. Создайте сессию командой /new",
  "context.confirm_text":
    '📊 Сжатие контекста для сессии "{title}"\n\nЭто уменьшит использование контекста, удалив старые сообщения из истории. Текущая задача не будет прервана.\n\nПродолжить?',
  "context.callback_session_not_found": "Сессия не найдена",
  "context.callback_compacting": "Сжатие контекста...",
  "context.progress": "⏳ Сжимаю контекст...",
  "context.error": "❌ Ошибка при сжатии контекста",
  "context.success": "✅ Контекст успешно сжат",
  "context.callback_cancelled": "Отменено",

  "permission.inactive_callback": "Запрос разрешения неактивен",
  "permission.processing_error_callback": "Ошибка при обработке",
  "permission.no_active_request_callback": "Ошибка: нет активного запроса",
  "permission.reply.once": "Разрешено однократно",
  "permission.reply.always": "Разрешено всегда",
  "permission.reply.reject": "Отклонено",
  "permission.send_reply_error": "❌ Не удалось отправить ответ на запрос разрешения",
  "permission.header": "{emoji} **Запрос разрешения: {name}**\n\n",
  "permission.button.allow": "✅ Разрешить",
  "permission.button.always": "🔓 Всегда",
  "permission.button.reject": "❌ Отклонить",
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

  "question.inactive_callback": "Опрос неактивен",
  "question.processing_error_callback": "Ошибка при обработке",
  "question.select_one_required_callback": "Выберите хотя бы один вариант",
  "question.enter_custom_callback": "Введите свой ответ сообщением",
  "question.cancelled": "❌ Опрос отменен",
  "question.answer_already_received": "Ответ уже получен, подождите...",
  "question.completed_no_answers": "✅ Опрос завершен (без ответов)",
  "question.no_active_project": "❌ Нет активного проекта",
  "question.no_active_request": "❌ Нет активного запроса",
  "question.send_answers_error": "❌ Не удалось отправить ответы агенту",
  "question.multi_hint": "\n*Можно выбрать несколько вариантов*",
  "question.button.submit": "✅ Готово",
  "question.button.custom": "🔤 Свой ответ",
  "question.button.cancel": "❌ Отмена",
  "question.summary.title": "✅ Опрос завершен!\n\n",
  "question.summary.question": "Вопрос {index}:\n{question}\n\n",
  "question.summary.answer": "Ответ:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Mode",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Default",
  "keyboard.updated": "⌨️ Клавиатура обновлена",

  "pinned.default_session_title": "new session",
  "pinned.unknown": "Unknown",
  "pinned.line.project": "Project: {project}",
  "pinned.line.model": "Model: {model}",
  "pinned.line.context": "Context: {used} / {limit} ({percent}%)",
  "pinned.files.title": "Files ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... and {count} more",

  "tool.todo.overflow": "*(ещё {count} задач)*",
  "tool.file_header.write":
    "Write File/Path: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Edit File/Path: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Введите токен Telegram-бота (получить у @BotFather).\n> ",
  "runtime.wizard.token_required": "Токен обязателен. Попробуйте еще раз.\n",
  "runtime.wizard.token_invalid":
    "Похоже на невалидный токен (ожидается формат <id>:<secret>). Попробуйте еще раз.\n",
  "runtime.wizard.ask_user_id": "Введите ваш Telegram User ID (можно узнать у @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Введите положительное целое число (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Введите URL OpenCode API (опционально).\nНажмите Enter для значения по умолчанию: {defaultUrl}\n> ",
  "runtime.wizard.api_url_invalid":
    "Введите корректный URL (http/https) или нажмите Enter для значения по умолчанию.\n",
  "runtime.wizard.start": "Запуск first-run wizard для настройки OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Конфигурация сохранена:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Приложение еще не сконфигурировано. Запускаю wizard...\n",
  "runtime.wizard.tty_required":
    "Интерактивный wizard требует TTY-терминал. Запустите `opencode-telegram config` в интерактивной оболочке.",
  "runtime.wizard.server_auth_header": "--- Аутентификация сервера (опционально) ---",
  "runtime.wizard.ask_server_username":
    "Введите имя пользователя OpenCode сервера (опционально, нажмите Enter для значения по умолчанию: opencode).\n> ",
  "runtime.wizard.ask_server_password":
    "Введите пароль OpenCode сервера (опционально, нажмите Enter чтобы пропустить).\n> ",

  "cli.usage":
    "Использование:\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nЗаметки:\n  - Без команды по умолчанию используется `start`\n  - `--mode` сейчас поддерживается только для `start`",
  "cli.placeholder.status":
    "Команда `status` пока работает как заглушка. Реальная проверка статуса появится на этапе service-слоя (Этап 5).",
  "cli.placeholder.stop":
    "Команда `stop` пока работает как заглушка. Реальная остановка фонового процесса появится на этапе service-слоя (Этап 5).",
  "cli.placeholder.unavailable": "Команда недоступна.",
  "cli.error.prefix": "CLI error: {message}",
  "cli.args.unknown_command": "Неизвестная команда: {value}",
  "cli.args.mode_requires_value": "Опция --mode требует значение: sources|installed",
  "cli.args.invalid_mode": "Некорректное значение --mode: {value}. Ожидается sources|installed",
  "cli.args.unknown_option": "Неизвестная опция: {value}",
  "cli.args.mode_only_start": "Опция --mode поддерживается только для команды start",

  "legacy.models.fetch_error":
    "🔴 Не удалось получить список моделей. Проверьте статус сервера /status.",
  "legacy.models.empty": "📋 Нет доступных моделей. Настройте провайдеры через OpenCode.",
  "legacy.models.header": "📋 **Доступные модели:**\n\n",
  "legacy.models.no_provider_models": "  ⚠️ Нет доступных моделей\n",
  "legacy.models.env_hint": "💡 Для использования модели в .env:\n",
  "legacy.models.error": "🔴 Произошла ошибка при получении списка моделей.",
};
