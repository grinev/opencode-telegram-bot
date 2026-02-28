import type { I18nDictionary } from "./en.js";

export const es: I18nDictionary = {
  "cmd.description.status": "Estado del servidor y de la sesión",
  "cmd.description.new": "Crear una sesión nueva",
  "cmd.description.stop": "Detener la acción actual",
  "cmd.description.sessions": "Listar sesiones",
  "cmd.description.projects": "Listar proyectos",
  "cmd.description.opencode_start": "Iniciar servidor OpenCode",
  "cmd.description.opencode_stop": "Detener servidor OpenCode",
  "cmd.description.help": "Ayuda",

  "callback.unknown_command": "Comando desconocido",
  "callback.processing_error": "Error de procesamiento",

  "error.load_agents": "❌ No se pudo cargar la lista de agentes",
  "error.load_models": "❌ No se pudo cargar la lista de modelos",
  "error.load_variants": "❌ No se pudo cargar la lista de variantes",
  "error.context_button": "❌ No se pudo procesar el botón de contexto",
  "error.generic": "🔴 Algo salió mal.",

  "interaction.blocked.expired": "⚠️ Esta interacción ha expirado. Por favor, iníciala de nuevo.",
  "interaction.blocked.expected_callback":
    "⚠️ Para este paso, usa los botones en línea o toca Cancelar.",
  "interaction.blocked.expected_text": "⚠️ Para este paso, envía un mensaje de texto.",
  "interaction.blocked.expected_command": "⚠️ Para este paso, envía un comando.",
  "interaction.blocked.command_not_allowed":
    "⚠️ Este comando no está disponible en el paso actual.",
  "interaction.blocked.finish_current":
    "⚠️ Termina primero la interacción actual (responde o cancela) y después abre otro menú.",

  "inline.blocked.expected_choice":
    "⚠️ Elige una opción usando los botones en línea o toca Cancelar.",
  "inline.blocked.command_not_allowed":
    "⚠️ Este comando no está disponible mientras el menú en línea está activo.",

  "question.blocked.expected_answer":
    "⚠️ Responde la pregunta actual usando botones, Respuesta personalizada o Cancelar.",
  "question.blocked.command_not_allowed":
    "⚠️ Este comando no está disponible hasta que se complete el flujo de la pregunta actual.",

  "inline.button.cancel": "❌ Cancelar",
  "inline.inactive_callback": "Este menú está inactivo",
  "inline.cancelled_callback": "Cancelado",

  "common.unknown": "desconocido",
  "common.unknown_error": "error desconocido",

  "start.welcome":
    "👋 ¡Bienvenido a OpenCode Telegram Bot!\n\nUsa los comandos:\n/projects — seleccionar proyecto\n/sessions — lista de sesiones\n/new — sesión nueva\n/status — estado\n/help — ayuda\n\nUsa los botones inferiores para elegir modo, modelo y variante.",
  "help.keyboard_hint":
    "💡 Usa los botones inferiores para modo del agente, modelo, variante y acciones de contexto.",
  "help.text":
    "📖 **Ayuda**\n\n/status - Ver estado del servidor\n/sessions - Lista de sesiones\n/new - Crear una sesión nueva\n/help - Ayuda",

  "bot.thinking": "💭 Pensando...",
  "bot.project_not_selected":
    "🏗 No hay un proyecto seleccionado.\n\nPrimero selecciona un proyecto con /projects.",
  "bot.creating_session": "🔄 Creando una sesión nueva...",
  "bot.create_session_error":
    "🔴 No se pudo crear la sesión. Prueba /new o revisa el estado del servidor con /status.",
  "bot.session_created": "✅ Sesión creada: {title}",
  "bot.session_busy":
    "⏳ El agente ya está ejecutando una tarea. Espera a que termine o usa /stop para interrumpir la ejecución actual.",
  "bot.session_reset_project_mismatch":
    "⚠️ La sesión activa no coincide con el proyecto seleccionado, así que se reinició. Usa /sessions para elegir una o /new para crear una nueva.",
  "bot.prompt_send_error": "No se pudo enviar la solicitud a OpenCode.",
  "bot.session_error": "🔴 OpenCode devolvió un error: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nEl proveedor devuelve el mismo error en intentos repetidos. Usa /stop para detenerlo.",
  "bot.unknown_command":
    "⚠️ Comando desconocido: {command}. Usa /help para ver los comandos disponibles.",
  "bot.photo_downloading": "⏳ Descargando foto...",
  "bot.photo_too_large": "⚠️ La foto es demasiado grande (max {maxSizeMb}MB)",
  "bot.photo_model_no_image":
    "⚠️ El modelo actual no admite entrada de imagen. Enviaré solo texto.",
  "bot.photo_download_error": "🔴 No se pudo descargar la foto",
  "bot.photo_no_caption":
    "💡 Consejo: agrega un pie de foto para describir que quieres hacer con esta foto.",

  "status.header_running": "🟢 **OpenCode Server está en ejecución**",
  "status.health.healthy": "Saludable",
  "status.health.unhealthy": "No saludable",
  "status.line.health": "Estado: {health}",
  "status.line.version": "Versión: {version}",
  "status.line.managed_yes": "Administrado por el bot: Sí",
  "status.line.managed_no": "Administrado por el bot: No",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Tiempo activo: {seconds} s",
  "status.line.mode": "Modo: {mode}",
  "status.line.model": "Modelo: {model}",
  "status.agent_not_set": "no configurado",
  "status.project_selected": "🏗 Proyecto: {project}",
  "status.project_not_selected": "🏗 Proyecto: no seleccionado",
  "status.project_hint": "Usa /projects para seleccionar un proyecto",
  "status.session_selected": "📋 Sesión actual: {title}",
  "status.session_not_selected": "📋 Sesión actual: no seleccionada",
  "status.session_hint": "Usa /sessions para elegir una o /new para crear una",
  "status.server_unavailable":
    "🔴 OpenCode Server no está disponible\n\nUsa /opencode_start para iniciar el servidor.",

  "projects.empty":
    "📭 No se encontraron proyectos.\n\nAbre un directorio en OpenCode y crea al menos una sesión; entonces aparecerá aquí.",
  "projects.select": "Selecciona un proyecto:",
  "projects.select_with_current": "Selecciona un proyecto:\n\nActual: 🏗 {project}",
  "projects.page_indicator": "Página {current}/{total}",
  "projects.prev_page": "⬅️ Anterior",
  "projects.next_page": "Siguiente ➡️",
  "projects.fetch_error":
    "🔴 OpenCode Server no está disponible u ocurrió un error al cargar los proyectos.",
  "projects.page_load_error": "No se puede cargar esta página. Inténtalo de nuevo.",
  "projects.selected":
    "✅ Proyecto seleccionado: {project}\n\n📋 La sesión se reinició. Usa /sessions o /new para este proyecto.",
  "projects.select_error": "🔴 No se pudo seleccionar el proyecto.",

  "sessions.project_not_selected":
    "🏗 No hay un proyecto seleccionado.\n\nPrimero selecciona un proyecto con /projects.",
  "sessions.empty": "📭 No se encontraron sesiones.\n\nCrea una sesión nueva con /new.",
  "sessions.select": "Selecciona una sesión:",
  "sessions.select_page": "Selecciona una sesión (página {page}):",
  "sessions.fetch_error":
    "🔴 OpenCode Server no está disponible u ocurrió un error al cargar las sesiones.",
  "sessions.select_project_first": "🔴 No hay un proyecto seleccionado. Usa /projects.",
  "sessions.page_empty_callback": "No hay sesiones en esta página",
  "sessions.page_load_error_callback": "No se puede cargar esta página. Inténtalo de nuevo.",
  "sessions.button.prev_page": "⬅️ Anterior",
  "sessions.button.next_page": "Siguiente ➡️",
  "sessions.loading_context": "⏳ Cargando contexto y los últimos mensajes...",
  "sessions.selected": "✅ Sesión seleccionada: {title}",
  "sessions.select_error": "🔴 No se pudo seleccionar la sesión.",
  "sessions.preview.empty": "No hay mensajes recientes.",
  "sessions.preview.title": "Mensajes recientes:",
  "sessions.preview.you": "Tú:",
  "sessions.preview.agent": "Agente:",

  "new.project_not_selected":
    "🏗 No hay un proyecto seleccionado.\n\nPrimero selecciona un proyecto con /projects.",
  "new.created": "✅ Sesión nueva creada: {title}",
  "new.create_error":
    "🔴 OpenCode Server no está disponible u ocurrió un error al crear la sesión.",

  "stop.no_active_session":
    "🛑 El agente no se inició\n\nCrea una sesión con /new o selecciona una con /sessions.",
  "stop.in_progress":
    "🛑 Flujo de eventos detenido; enviando señal de aborto...\n\nEsperando a que el agente se detenga.",
  "stop.warn_unconfirmed":
    "⚠️ Flujo de eventos detenido, pero el servidor no confirmó el aborto.\n\nRevisa /status y vuelve a intentar /stop en unos segundos.",
  "stop.warn_maybe_finished":
    "⚠️ Flujo de eventos detenido, pero el agente podría haber terminado ya.",
  "stop.success":
    "✅ Acción del agente interrumpida. No se enviarán más mensajes de esta ejecución.",
  "stop.warn_still_busy":
    "⚠️ Señal enviada, pero el agente sigue ocupado.\n\nEl flujo de eventos ya está deshabilitado, así que no se enviarán mensajes intermedios.",
  "stop.warn_timeout":
    "⚠️ Tiempo de espera agotado al solicitar el aborto.\n\nEl flujo de eventos ya está deshabilitado; vuelve a intentar /stop en unos segundos.",
  "stop.warn_local_only":
    "⚠️ Flujo de eventos detenido localmente, pero el aborto en el servidor falló.",
  "stop.error":
    "🔴 No se pudo detener la acción.\n\nEl flujo de eventos está detenido; prueba /stop otra vez.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Server ya está en ejecución\n\nPID: {pid}\nTiempo activo: {seconds} segundos",
  "opencode_start.already_running_external":
    "✅ OpenCode Server ya está en ejecución como un proceso externo\n\nVersión: {version}\n\nEste servidor no fue iniciado por el bot, por lo que /opencode-stop no puede detenerlo.",
  "opencode_start.starting": "🔄 Iniciando OpenCode Server...",
  "opencode_start.start_error":
    "🔴 No se pudo iniciar OpenCode Server\n\nError: {error}\n\nRevisa que OpenCode CLI esté instalado y disponible en PATH:\n`opencode --version`\n`npm install -g @opencode-ai/cli`",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Server se inició, pero no responde\n\nPID: {pid}\n\nEl servidor puede estar iniciando. Prueba /status en unos segundos.",
  "opencode_start.success":
    "✅ OpenCode Server iniciado correctamente\n\nPID: {pid}\nVersión: {version}",
  "opencode_start.error":
    "🔴 Ocurrió un error al iniciar el servidor.\n\nRevisa los logs de la aplicación para más detalles.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Server está en ejecución como un proceso externo\n\nEste servidor no fue iniciado con /opencode-start.\nDeténlo manualmente o usa /status para revisar el estado.",
  "opencode_stop.not_running": "⚠️ OpenCode Server no está en ejecución",
  "opencode_stop.stopping": "🛑 Deteniendo OpenCode Server...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 No se pudo detener OpenCode Server\n\nError: {error}",
  "opencode_stop.success": "✅ OpenCode Server detenido correctamente",
  "opencode_stop.error":
    "🔴 Ocurrió un error al detener el servidor.\n\nRevisa los logs de la aplicación para más detalles.",

  "agent.changed_callback": "Modo cambiado: {name}",
  "agent.changed_message": "✅ Modo cambiado a: {name}",
  "agent.change_error_callback": "No se pudo cambiar el modo",
  "agent.menu.current": "Modo actual: {name}\n\nSelecciona el modo:",
  "agent.menu.select": "Selecciona el modo de trabajo:",

  "model.changed_callback": "Modelo cambiado: {name}",
  "model.changed_message": "✅ Modelo cambiado a: {name}",
  "model.change_error_callback": "No se pudo cambiar el modelo",
  "model.menu.empty": "⚠️ No hay modelos disponibles",
  "model.menu.select": "Selecciona el modelo:",
  "model.menu.current": "Modelo actual: {name}\n\nSelecciona el modelo:",
  "model.menu.favorites_title": "⭐ Favoritos (Agrega modelos a favoritos en OpenCode CLI)",
  "model.menu.favorites_empty": "— Vacío.",
  "model.menu.recent_title": "🕘 Recientes",
  "model.menu.recent_empty": "— Vacío.",
  "model.menu.favorites_hint":
    "ℹ️ Agrega modelos a favoritos en OpenCode CLI para mantenerlos arriba de la lista.",
  "model.menu.error": "🔴 No se pudo obtener la lista de modelos",

  "variant.model_not_selected_callback": "Error: no hay un modelo seleccionado",
  "variant.changed_callback": "Variante cambiada: {name}",
  "variant.changed_message": "✅ Variante cambiada a: {name}",
  "variant.change_error_callback": "No se pudo cambiar la variante",
  "variant.select_model_first": "⚠️ Selecciona un modelo primero",
  "variant.menu.empty": "⚠️ No hay variantes disponibles",
  "variant.menu.current": "Variante actual: {name}\n\nSelecciona la variante:",
  "variant.menu.error": "🔴 No se pudo obtener la lista de variantes",

  "context.button.confirm": "✅ Sí, compactar contexto",
  "context.no_active_session": "⚠️ No hay una sesión activa. Crea una sesión con /new",
  "context.confirm_text":
    '📊 Compactación de contexto para la sesión "{title}"\n\nEsto reducirá el uso de contexto eliminando mensajes antiguos del historial. La tarea actual no se interrumpirá.\n\n¿Continuar?',
  "context.callback_session_not_found": "Sesión no encontrada",
  "context.callback_compacting": "Compactando contexto...",
  "context.progress": "⏳ Compactando contexto...",
  "context.error": "❌ La compactación de contexto falló",
  "context.success": "✅ Contexto compactado correctamente",

  "permission.inactive_callback": "La solicitud de permisos está inactiva",
  "permission.processing_error_callback": "Error de procesamiento",
  "permission.no_active_request_callback": "Error: no hay una solicitud activa",
  "permission.reply.once": "Permitido una vez",
  "permission.reply.always": "Siempre permitido",
  "permission.reply.reject": "Rechazado",
  "permission.send_reply_error": "❌ No se pudo enviar la respuesta de permisos",
  "permission.blocked.expected_reply":
    "⚠️ Primero responde a la solicitud de permisos usando los botones de arriba.",
  "permission.blocked.command_not_allowed":
    "⚠️ Este comando no está disponible hasta que respondas a la solicitud de permisos.",
  "permission.header": "{emoji} **Solicitud de permisos: {name}**\n\n",
  "permission.button.allow": "✅ Permitir una vez",
  "permission.button.always": "🔓 Permitir siempre",
  "permission.button.reject": "❌ Rechazar",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Editar",
  "permission.name.write": "Escribir",
  "permission.name.read": "Leer",
  "permission.name.webfetch": "Obtener web",
  "permission.name.websearch": "Buscar en la web",
  "permission.name.glob": "Buscar archivos",
  "permission.name.grep": "Buscar contenido",
  "permission.name.list": "Listar directorio",
  "permission.name.task": "Tarea",
  "permission.name.lsp": "LSP",

  "question.inactive_callback": "La encuesta está inactiva",
  "question.processing_error_callback": "Error de procesamiento",
  "question.select_one_required_callback": "Selecciona al menos una opción",
  "question.enter_custom_callback": "Envía tu respuesta personalizada como mensaje",
  "question.cancelled": "❌ Encuesta cancelada",
  "question.answer_already_received": "Respuesta ya recibida, espera...",
  "question.completed_no_answers": "✅ Encuesta completada (sin respuestas)",
  "question.no_active_project": "❌ No hay un proyecto activo",
  "question.no_active_request": "❌ No hay una solicitud activa",
  "question.send_answers_error": "❌ No se pudieron enviar las respuestas al agente",
  "question.multi_hint": "\n*Puedes seleccionar varias opciones*",
  "question.button.submit": "✅ Listo",
  "question.button.custom": "🔤 Respuesta personalizada",
  "question.button.cancel": "❌ Cancelar",
  "question.use_custom_button_first":
    '⚠️ Para enviar texto, primero toca "Respuesta personalizada" para la pregunta actual.',
  "question.summary.title": "✅ ¡Encuesta completada!\n\n",
  "question.summary.question": "Pregunta {index}:\n{question}\n\n",
  "question.summary.answer": "Respuesta:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} Modo {name}",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Predeterminado",
  "keyboard.updated": "⌨️ Teclado actualizado",

  "pinned.default_session_title": "sesión nueva",
  "pinned.unknown": "Desconocido",
  "pinned.line.project": "Proyecto: {project}",
  "pinned.line.model": "Modelo: {model}",
  "pinned.line.context": "Contexto: {used} / {limit} ({percent}%)",
  "pinned.files.title": "Archivos ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... y {count} más",

  "tool.todo.overflow": "*({count} tareas más)*",
  "tool.file_header.write":
    "Escribir archivo/ruta: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Editar archivo/ruta: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Introduce el token del bot de Telegram (obtenlo de @BotFather).\n> ",
  "runtime.wizard.ask_language":
    "Selecciona el idioma de la interfaz.\nIntroduce el número del idioma de la lista o el código de locale.\nPulsa Enter para mantener el idioma por defecto: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Introduce un número de idioma de la lista o un código de locale compatible.\n",
  "runtime.wizard.language_selected": "Idioma seleccionado: {language}\n",
  "runtime.wizard.token_required": "El token es obligatorio. Inténtalo de nuevo.\n",
  "runtime.wizard.token_invalid":
    "El token parece inválido (se espera el formato <id>:<secret>). Inténtalo de nuevo.\n",
  "runtime.wizard.ask_user_id":
    "Introduce tu Telegram User ID (puedes obtenerlo de @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Introduce un entero positivo (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Introduce la URL de la API de OpenCode (opcional).\nPulsa Enter para usar el valor por defecto: {defaultUrl}\n> ",
  "runtime.wizard.api_url_invalid":
    "Introduce una URL válida (http/https) o pulsa Enter para usar el valor por defecto.\n",
  "runtime.wizard.start": "Configuración de OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Configuración guardada:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "La aplicación aún no está configurada. Iniciando el asistente...\n",
  "runtime.wizard.tty_required":
    "El asistente interactivo requiere un terminal TTY. Ejecuta `opencode-telegram config` en una shell interactiva.",

  "rename.no_session": "⚠️ No hay una sesión activa. Crea o selecciona una sesión primero.",
  "rename.prompt": "📝 Introduce un nuevo título para la sesión:\n\nActual: {title}",
  "rename.empty_title": "⚠️ El título no puede estar vacío.",
  "rename.success": "✅ Sesión renombrada a: {title}",
  "rename.error": "🔴 No se pudo renombrar la sesión.",
  "rename.cancelled": "❌ Cambio de nombre cancelado.",
  "rename.inactive_callback": "La solicitud de cambio de nombre está inactiva",
  "rename.inactive":
    "⚠️ La solicitud de cambio de nombre no está activa. Ejecuta /rename otra vez.",
  "rename.blocked.expected_name":
    "⚠️ Introduce el nuevo nombre de la sesión como texto o toca Cancelar en el mensaje de cambio de nombre.",
  "rename.blocked.command_not_allowed":
    "⚠️ Este comando no está disponible mientras el cambio de nombre espera un nuevo nombre.",
  "rename.button.cancel": "❌ Cancelar",

  "cmd.description.rename": "Renombrar la sesión actual",

  "cli.usage":
    "Uso:\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nNotas:\n  - Sin comando, el valor por defecto es `start`\n  - `--mode` actualmente solo se admite para `start`",
  "cli.placeholder.status":
    "El comando `status` es actualmente un marcador de posición. Las comprobaciones reales de estado se agregarán en la capa de servicio (Fase 5).",
  "cli.placeholder.stop":
    "El comando `stop` es actualmente un marcador de posición. La detención real del proceso en segundo plano se agregará en la capa de servicio (Fase 5).",
  "cli.placeholder.unavailable": "El comando no esta disponible.",
  "cli.error.prefix": "Error de CLI: {message}",
  "cli.args.unknown_command": "Comando desconocido: {value}",
  "cli.args.mode_requires_value": "La opción --mode requiere un valor: sources|installed",
  "cli.args.invalid_mode": "Valor de --mode inválido: {value}. Se espera sources|installed",
  "cli.args.unknown_option": "Opción desconocida: {value}",
  "cli.args.mode_only_start": "La opción --mode solo se admite para el comando start",

  "legacy.models.fetch_error":
    "🔴 No se pudo obtener la lista de modelos. Revisa el estado del servidor con /status.",
  "legacy.models.empty": "📋 No hay modelos disponibles. Configura los proveedores en OpenCode.",
  "legacy.models.header": "📋 **Modelos disponibles:**\n\n",
  "legacy.models.no_provider_models": "  ⚠️ No hay modelos disponibles\n",
  "legacy.models.env_hint": "💡 Para usar el modelo en .env:\n",
  "legacy.models.error": "🔴 Ocurrió un error al cargar la lista de modelos.",

  "stt.recognizing": "🎤 Reconociendo audio...",
  "stt.recognized": "🎤 Reconocido:\n{text}",
  "stt.not_configured":
    "🎤 El reconocimiento de voz no está configurado.\n\nConfigura STT_API_URL y STT_API_KEY en .env para habilitarlo.",
  "stt.error": "🔴 No se pudo reconocer el audio: {error}",
  "stt.empty_result": "🎤 No se detectó voz en el mensaje de audio.",
};
