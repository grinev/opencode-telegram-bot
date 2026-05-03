import type { I18nDictionary } from "./en.js";

export const de: I18nDictionary = {
  "cmd.description.status": "Server- und Sitzungsstatus",
  "cmd.description.new": "Neue Sitzung erstellen",
  "cmd.description.stop": "Aktuelle Aktion stoppen",
  "cmd.description.sessions": "Sitzungen auflisten",
  "cmd.description.tts": "Audioantworten umschalten",
  "cmd.description.projects": "Projekte auflisten",
  "cmd.description.worktree": "Git-Worktrees wechseln",
  "cmd.description.task": "Geplante Aufgabe erstellen",
  "cmd.description.tasklist": "Geplante Aufgaben anzeigen",
  "cmd.description.commands": "Benutzerdefinierte Befehle",
  "cmd.description.skills": "Skill-Katalog",
  "cmd.description.mcps": "MCP servers",
  "cmd.description.opencode_start": "OpenCode-Server starten",
  "cmd.description.opencode_stop": "OpenCode-Server stoppen",
  "cmd.description.help": "Hilfe",

  "callback.unknown_command": "Unbekannter Befehl",
  "callback.processing_error": "Verarbeitungsfehler",

  "error.load_agents": "❌ Agentenliste konnte nicht geladen werden",
  "error.load_models": "❌ Modellliste konnte nicht geladen werden",
  "error.load_variants": "❌ Variantenliste konnte nicht geladen werden",
  "error.context_button": "❌ Kontext-Button konnte nicht verarbeitet werden",
  "error.generic": "🔴 Etwas ist schiefgelaufen.",

  "interaction.blocked.expired": "⚠️ Diese Interaktion ist abgelaufen. Bitte starte sie erneut.",
  "interaction.blocked.expected_callback":
    "⚠️ Bitte benutze für diesen Schritt die Inline-Buttons oder tippe auf Abbrechen.",
  "interaction.blocked.expected_text": "⚠️ Bitte sende für diesen Schritt eine Textnachricht.",
  "interaction.blocked.expected_command": "⚠️ Bitte sende für diesen Schritt einen Befehl.",
  "interaction.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist in diesem Schritt nicht verfügbar.",
  "interaction.blocked.finish_current":
    "⚠️ Schließe zuerst die aktuelle Interaktion ab (antworten oder abbrechen), dann öffne ein anderes Menü.",

  "inline.blocked.expected_choice":
    "⚠️ Wähle eine Option über die Inline-Buttons oder tippe auf Abbrechen.",
  "inline.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist nicht verfügbar, solange das Inline-Menü aktiv ist.",

  "question.blocked.expected_answer":
    "⚠️ Beantworte die aktuelle Frage über Buttons, Eigene Antwort oder Abbrechen.",
  "question.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist erst verfügbar, wenn der aktuelle Frage-Flow abgeschlossen ist.",

  "inline.button.cancel": "❌ Abbrechen",
  "inline.inactive_callback": "Dieses Menü ist inaktiv",
  "inline.cancelled_callback": "Abgebrochen",

  "common.unknown": "unbekannt",
  "common.unknown_error": "unbekannter Fehler",

  "start.welcome":
    "👋 Willkommen beim OpenCode Telegram Bot!\n\nNutze Befehle:\n/projects — Projekt auswählen\n/sessions — Sitzungsliste\n/new — neue Sitzung\n/commands — benutzerdefinierte Befehle\n/skills — Skill-Katalog\n/task — geplante Aufgabe\n/tasklist — geplante Aufgaben\n/status — Status\n/help — Hilfe\n\nNutze die unteren Buttons, um Agent, Modell und Variante zu wählen.",
  "help.keyboard_hint":
    "💡 Nutze die unteren Buttons für Agent, Modell, Variante und Kontextaktionen.",
  "help.text":
    "📖 **Hilfe**\n\n/status - Serverstatus prüfen\n/sessions - Sitzungsliste\n/new - Neue Sitzung erstellen\n/help - Hilfe",

  "bot.thinking": "💭 Denke...",
  "bot.project_not_selected":
    "🏗 Projekt ist nicht ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "bot.creating_session": "🔄 Erstelle eine neue Sitzung...",
  "bot.create_session_error":
    "🔴 Sitzung konnte nicht erstellt werden. Versuche /new oder prüfe den Serverstatus mit /status.",
  "bot.session_created": "✅ Sitzung erstellt: {title}",
  "bot.session_busy":
    "⏳ Agent führt bereits eine Aufgabe aus. Warte auf Abschluss oder nutze /abort, um den aktuellen Lauf zu unterbrechen.",
  "bot.session_reset_project_mismatch":
    "⚠️ Die aktive Sitzung passt nicht zum ausgewählten Projekt und wurde daher zurückgesetzt. Nutze /sessions zur Auswahl oder /new, um eine neue Sitzung zu erstellen.",
  "bot.prompt_send_error": "Anfrage konnte nicht an OpenCode gesendet werden.",
  "bot.session_error": "🔴 OpenCode meldete einen Fehler: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nDer Provider liefert bei wiederholten Versuchen immer wieder denselben Fehler. Mit /abort abbrechen.",
  "bot.external_user_input": "Externe Benutzereingabe",
  "bot.unknown_command":
    "⚠️ Unbekannter Befehl: {command}. Nutze /help, um verfügbare Befehle zu sehen.",
  "bot.photo_downloading": "⏳ Lade Foto herunter...",
  "bot.photo_too_large": "⚠️ Foto ist zu groß (max. {maxSizeMb}MB)",
  "bot.photo_model_no_image":
    "⚠️ Das aktuelle Modell unterstützt keine Bildeingabe. Sende nur Text.",
  "bot.photo_download_error": "🔴 Foto konnte nicht heruntergeladen werden",
  "bot.photo_no_caption":
    "💡 Tipp: Füge eine Bildunterschrift hinzu, um zu beschreiben, was du mit diesem Foto tun möchtest.",
  "bot.file_downloading": "⏳ Lade Datei herunter...",
  "bot.file_too_large": "⚠️ Datei ist zu groß (max. {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 Datei konnte nicht heruntergeladen werden",
  "bot.model_no_pdf": "⚠️ Das aktuelle Modell unterstützt keine PDF-Eingabe. Sende nur Text.",
  "bot.text_file_too_large": "⚠️ Textdatei ist zu groß (max. {maxSizeKb}KB)",

  "status.header_running": "🟢 OpenCode-Server läuft",
  "status.health.healthy": "OK",
  "status.health.unhealthy": "Nicht OK",
  "status.line.health": "Status: {health}",
  "status.line.version": "Version: {version}",
  "status.line.managed_yes": "Vom Bot gestartet: Ja",
  "status.line.managed_no": "Vom Bot gestartet: Nein",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Betriebszeit: {seconds} s",
  "status.line.mode": "Agent: {mode}",
  "status.line.model": "Modell: {model}",
  "status.line.tts": "TTS-Antworten: {tts}",
  "status.tts.on": "Ein",
  "status.tts.off": "Aus",
  "status.agent_not_set": "nicht gesetzt",
  "status.project_selected": "Projekt: {project}",
  "status.worktree_selected": "Worktree: {worktree}",
  "status.project_not_selected": "Projekt: nicht ausgewählt",
  "status.project_hint": "Nutze /projects, um ein Projekt auszuwahlen",
  "status.session_selected": "Aktuelle Sitzung: {title}",
  "status.session_not_selected": "Aktuelle Sitzung: nicht ausgewählt",
  "status.session_hint": "Nutze /sessions zur Auswahl oder /new zum Erstellen",
  "status.server_unavailable":
    "🔴 OpenCode-Server ist nicht verfügbar\n\nNutze /opencode_start, um den Server zu starten.",

  "tts.enabled": "🔊 Audioantworten global aktiviert.",
  "tts.not_configured":
    "⚠️ Audioantworten sind nicht verfugbar. Setze zuerst `TTS_API_URL` und `TTS_API_KEY`.",
  "tts.disabled": "🔇 Audioantworten global deaktiviert.",
  "tts.failed": "⚠️ Audioreply konnte nicht erzeugt werden.",

  "projects.empty":
    "📭 Keine Projekte gefunden.\n\nÖffne ein Verzeichnis in OpenCode und erstelle mindestens eine Sitzung, dann erscheint es hier.",
  "projects.select": "Projekt auswählen:",
  "projects.select_with_current": "Projekt auswählen:\n\nAktuell: 🏗 {project}",
  "projects.page_indicator": "Seite {current}/{total}",
  "projects.prev_page": "⬅️ Zurück",
  "projects.next_page": "Weiter ➡️",
  "projects.fetch_error":
    "🔴 OpenCode-Server ist nicht verfügbar oder beim Laden der Projekte ist ein Fehler aufgetreten.",
  "projects.page_load_error": "Diese Seite konnte nicht geladen werden. Bitte versuche es erneut.",
  "projects.selected":
    "✅ Projekt ausgewählt: {project}\n\n📋 Sitzung wurde zurückgesetzt. Nutze /sessions oder /new für dieses Projekt.",
  "projects.select_error": "🔴 Projekt konnte nicht ausgewählt werden.",

  "sessions.project_not_selected":
    "🏗 Projekt ist nicht ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "sessions.empty": "📭 Keine Sitzungen gefunden.\n\nErstelle eine neue Sitzung mit /new.",
  "sessions.select": "Sitzung auswählen:",
  "sessions.select_page": "Sitzung auswählen (Seite {page}):",
  "sessions.fetch_error":
    "🔴 OpenCode-Server ist nicht verfügbar oder beim Laden der Sitzungen ist ein Fehler aufgetreten.",
  "sessions.select_project_first": "🔴 Projekt ist nicht ausgewählt. Nutze /projects.",
  "sessions.page_empty_callback": "Auf dieser Seite gibt es keine Sitzungen",
  "sessions.page_load_error_callback":
    "Diese Seite kann nicht geladen werden. Bitte versuche es erneut.",
  "sessions.button.prev_page": "⬅️ Zurück",
  "sessions.button.next_page": "Weiter ➡️",
  "sessions.loading_context": "⏳ Lade Kontext und letzte Nachrichten...",
  "sessions.selected": "✅ Sitzung ausgewählt: {title}",
  "sessions.select_error": "🔴 Sitzung konnte nicht ausgewählt werden.",
  "sessions.preview.empty": "Keine neuen Nachrichten.",
  "sessions.preview.title": "Letzte Nachrichten:",
  "sessions.preview.you": "Du:",
  "sessions.preview.agent": "Agent:",

  "attach.project_not_selected":
    "🏗 Projekt ist nicht ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "attach.session_not_selected":
    "💬 Keine Sitzung ausgewählt.\n\nWähle zuerst mit /sessions eine Sitzung aus.",
  "attach.session_project_mismatch":
    "⚠️ Die ausgewählte Sitzung passt nicht zum aktuellen Projekt. Wähle sie über /sessions erneut aus.",
  "attach.connected": "✅ Mit Sitzung verbunden: {title}",
  "attach.already_connected": "ℹ️ Bereits mit Sitzung verbunden: {title}",
  "attach.status.idle_message": "Status: idle. Warte auf neue Ereignisse.",
  "attach.status.busy_message": "Status: busy. Neue Prompts sind vorübergehend blockiert.",
  "attach.restored_question": "Eine ausstehende Frage für diese Sitzung wurde wiederhergestellt.",
  "attach.restored_permissions": "Ausstehende Berechtigungsanfragen wiederhergestellt: {count}.",
  "attach.disconnect_hint":
    "Zum Trennen einfach zu einer anderen Sitzung oder einem anderen Projekt wechseln.",
  "attach.error": "🔴 Verbindung mit der aktuellen Sitzung fehlgeschlagen.",

  "new.project_not_selected":
    "🏗 Projekt ist nicht ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "new.created": "✅ Neue Sitzung erstellt: {title}",
  "new.create_error":
    "🔴 OpenCode-Server ist nicht verfügbar oder beim Erstellen der Sitzung ist ein Fehler aufgetreten.",

  "stop.no_active_session":
    "🛑 Agent wurde nicht gestartet\n\nErstelle eine Sitzung mit /new oder wähle eine über /sessions aus.",
  "stop.in_progress":
    "🛑 Event-Stream gestoppt, sende Abbruchsignal...\n\nWarte darauf, dass der Agent stoppt.",
  "stop.warn_unconfirmed":
    "⚠️ Event-Stream gestoppt, aber der Server hat den Abbruch nicht bestätigt.\n\nPrüfe /status und versuche /abort in ein paar Sekunden erneut.",
  "stop.warn_maybe_finished":
    "⚠️ Event-Stream gestoppt, aber der Agent konnte bereits fertig sein.",
  "stop.success":
    "✅ Agent-Aktion unterbrochen. Von diesem Lauf werden keine weiteren Nachrichten gesendet.",
  "stop.warn_still_busy":
    "⚠️ Signal gesendet, aber der Agent ist noch beschäftigt.\n\nDer Event-Stream ist bereits deaktiviert, daher werden keine Zwischenmeldungen gesendet.",
  "stop.warn_timeout":
    "⚠️ Timeout beim Abbruch.\n\nDer Event-Stream ist bereits deaktiviert, versuche /abort in ein paar Sekunden erneut.",
  "stop.warn_local_only":
    "⚠️ Event-Stream lokal gestoppt, aber serverseitiger Abbruch ist fehlgeschlagen.",
  "stop.error":
    "🔴 Aktion konnte nicht gestoppt werden.\n\nEvent-Stream ist gestoppt, versuche /abort erneut.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode-Server läuft bereits\n\nPID: {pid}\nBetriebszeit: {seconds} Sekunden",
  "opencode_start.already_running_external":
    "✅ OpenCode-Server läuft bereits als externer Prozess\n\nVersion: {version}\n\nDieser Server wurde nicht vom Bot gestartet, daher kann /opencode-stop ihn nicht stoppen.",
  "opencode_start.already_running": "✅ OpenCode-Server läuft bereits\n\nVersion: {version}",
  "opencode_start.remote_configured":
    "⚠️ /opencode_start funktioniert nur mit einem lokalen OpenCode-Server.",
  "opencode_start.starting": "🔄 Starte OpenCode-Server...",
  "opencode_start.start_error":
    "🔴 OpenCode-Server konnte nicht gestartet werden\n\nFehler: {error}\n\nPrüfe, ob OpenCode CLI installiert und im PATH verfügbar ist:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode-Server gestartet, aber reagiert nicht\n\nPID: {pid}\n\nDer Server startet möglicherweise noch. Versuche /status in ein paar Sekunden.",
  "opencode_start.success":
    "✅ OpenCode-Server erfolgreich gestartet\n\nPID: {pid}\nVersion: {version}",
  "opencode_start.error":
    "🔴 Beim Starten des Servers ist ein Fehler aufgetreten.\n\nSiehe Anwendungslogs für Details.",
  "opencode_stop.external_running":
    "⚠️ OpenCode-Server läuft als externer Prozess\n\nDieser Server wurde nicht über /opencode-start gestartet.\nStoppe ihn manuell oder nutze /status, um den Zustand zu prüfen.",
  "opencode_stop.remote_configured":
    "⚠️ /opencode_stop funktioniert nur mit einem lokalen OpenCode-Server.",
  "opencode_stop.not_running": "⚠️ OpenCode-Server läuft nicht",
  "opencode_stop.pid_not_found":
    "⚠️ OpenCode-Server antwortet auf Port {port}, aber es wurde kein lokaler Prozess zum Stoppen gefunden.",
  "opencode_stop.stopping": "🛑 Stoppe OpenCode-Server...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 OpenCode-Server konnte nicht gestoppt werden\n\nFehler: {error}",
  "opencode_stop.still_running": "Der Server antwortet nach der Stop-Anfrage weiterhin.",
  "opencode_stop.success": "✅ OpenCode-Server erfolgreich gestoppt",
  "opencode_stop.error":
    "🔴 Beim Stoppen des Servers ist ein Fehler aufgetreten.\n\nSiehe Anwendungslogs für Details.",

  "agent.changed_callback": "Agent geändert: {name}",
  "agent.changed_message": "✅ Agent geändert zu: {name}",
  "agent.change_error_callback": "Agent konnte nicht geändert werden",
  "agent.menu.current": "Aktueller Agent: {name}\n\nAgent auswählen:",
  "agent.menu.select": "Agent auswählen:",
  "agent.menu.empty": "⚠️ Keine verfügbaren Agenten",
  "agent.menu.error": "🔴 Agentenliste konnte nicht geladen werden",

  "model.changed_callback": "Modell geändert: {name}",
  "model.changed_message": "✅ Modell geändert zu: {name}",
  "model.change_error_callback": "Modell konnte nicht geändert werden",
  "model.menu.empty": "⚠️ Keine verfügbaren Modelle",
  "model.menu.select": "Modell auswählen:",
  "model.menu.current": "Aktuelles Modell: {name}\n\nModell auswählen:",
  "model.menu.favorites_title":
    "⭐ Favoriten (Füge Modelle in OpenCode CLI zu den Favoriten hinzu)",
  "model.menu.favorites_empty": "— Leer.",
  "model.menu.recent_title": "🕘 Zuletzt verwendet",
  "model.menu.recent_empty": "— Leer.",
  "model.menu.favorites_hint":
    "ℹ️ Füge Modelle in OpenCode CLI zu den Favoriten hinzu, damit sie oben angezeigt werden.",
  "model.menu.error": "🔴 Modellliste konnte nicht geladen werden",

  "variant.model_not_selected_callback": "Fehler: Modell ist nicht ausgewählt",
  "variant.changed_callback": "Variante geändert: {name}",
  "variant.changed_message": "✅ Variante geändert zu: {name}",
  "variant.change_error_callback": "Variante konnte nicht geändert werden",
  "variant.select_model_first": "⚠️ Zuerst ein Modell auswählen",
  "variant.menu.empty": "⚠️ Keine verfügbaren Varianten",
  "variant.menu.current": "Aktuelle Variante: {name}\n\nVariante auswählen:",
  "variant.menu.error": "🔴 Variantenliste konnte nicht geladen werden",

  "context.button.confirm": "✅ Ja, Kontext komprimieren",
  "context.no_active_session": "⚠️ Keine aktive Sitzung. Erstelle eine Sitzung mit /new",
  "context.confirm_text":
    '📊 Kontext-Komprimierung für Sitzung "{title}"\n\nDadurch wird die Kontextnutzung reduziert, indem alte Nachrichten aus dem Verlauf entfernt werden. Die aktuelle Aufgabe wird nicht unterbrochen.\n\nFortfahren?',
  "context.callback_session_not_found": "Sitzung nicht gefunden",
  "context.callback_compacting": "Komprimiere Kontext...",
  "context.progress": "⏳ Komprimiere Kontext...",
  "context.error": "❌ Kontext-Komprimierung fehlgeschlagen",
  "context.success": "✅ Kontext erfolgreich komprimiert",

  "permission.inactive_callback": "Berechtigungsanfrage ist inaktiv",
  "permission.processing_error_callback": "Verarbeitungsfehler",
  "permission.no_active_request_callback": "Fehler: keine aktive Anfrage",
  "permission.reply.once": "Einmal erlaubt",
  "permission.reply.always": "Immer erlaubt",
  "permission.reply.reject": "Abgelehnt",
  "permission.send_reply_error": "❌ Antwort auf Berechtigungsanfrage konnte nicht gesendet werden",
  "permission.blocked.expected_reply":
    "⚠️ Bitte beantworte zuerst die Berechtigungsanfrage mit den Buttons oben.",
  "permission.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist erst verfügbar, wenn du die Berechtigungsanfrage beantwortet hast.",
  "permission.header": "{emoji} Berechtigungsanfrage: {name}\n\n",
  "permission.button.allow": "✅ Einmal erlauben",
  "permission.button.always": "🔓 Immer erlauben",
  "permission.button.reject": "❌ Ablehnen",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Bearbeiten",
  "permission.name.write": "Schreiben",
  "permission.name.read": "Lesen",
  "permission.name.webfetch": "Web-Abruf",
  "permission.name.websearch": "Web-Suche",
  "permission.name.glob": "Dateisuche",
  "permission.name.grep": "Inhaltssuche",
  "permission.name.list": "Verzeichnis auflisten",
  "permission.name.task": "Task",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "Externes Verzeichnis",

  "question.inactive_callback": "Umfrage ist inaktiv",
  "question.processing_error_callback": "Verarbeitungsfehler",
  "question.select_one_required_callback": "Wähle mindestens eine Option",
  "question.enter_custom_callback": "Sende deine eigene Antwort als Nachricht",
  "question.cancelled": "❌ Umfrage abgebrochen",
  "question.answer_already_received": "Antwort bereits erhalten, bitte warten...",
  "question.completed_no_answers": "✅ Umfrage abgeschlossen (keine Antworten)",
  "question.no_active_project": "❌ Kein aktives Projekt",
  "question.no_active_request": "❌ Keine aktive Anfrage",
  "question.send_answers_error": "❌ Antworten konnten nicht an den Agenten gesendet werden",
  "question.multi_hint": "\n(Du kannst mehrere Optionen auswählen)",
  "question.button.submit": "✅ Fertig",
  "question.button.custom": "🔤 Eigene Antwort",
  "question.button.cancel": "❌ Abbrechen",
  "question.use_custom_button_first":
    '⚠️ Um Text zu senden, tippe zuerst bei der aktuellen Frage auf "Eigene Antwort".',
  "question.summary.title": "✅ Umfrage abgeschlossen!\n\n",
  "question.summary.question": "Frage {index}:\n{question}\n\n",
  "question.summary.answer": "Antwort:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Agent",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Standard",
  "keyboard.updated": "⌨️ Tastatur aktualisiert",

  "pinned.default_session_title": "neue Sitzung",
  "pinned.unknown": "Unbekannt",
  "pinned.line.project": "Projekt: {project}",
  "pinned.line.worktree": "Worktree: {worktree}",
  "pinned.line.model": "Modell: {model}",
  "pinned.line.attach": "Tracking: {status}",
  "pinned.attach.status.idle": "aktiv, idle",
  "pinned.attach.status.busy": "aktiv, busy",
  "pinned.line.context": "Kontext: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "Kosten: {cost} ausgegeben",
  "subagent.header": "Subagent {agent}: {description}",
  "subagent.line.status": "Status: {status}",
  "subagent.line.task": "Aufgabe: {task}",
  "subagent.line.agent": "Agent: {agent}",
  "subagent.working": "Arbeitet...",
  "subagent.working_with_details": "Arbeitet: {details}",
  "subagent.completed": "Abgeschlossen",
  "subagent.failed": "Aufgabe fehlgeschlagen",
  "subagent.status.pending": "ausstehend",
  "subagent.status.running": "laeuft",
  "subagent.status.completed": "abgeschlossen",
  "subagent.status.error": "Fehler",
  "pinned.files.title": "Dateien ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... und {count} mehr",

  "tool.todo.overflow": "*({count} weitere Aufgaben)*",
  "tool.file_header.write":
    "Datei/Pfad schreiben: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Datei/Pfad bearbeiten: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Telegram-Bot-Token eingeben (von @BotFather).\n> ",
  "runtime.wizard.ask_language":
    "Oberflächensprache auswählen.\nGib die Sprach-Nummer aus der Liste oder den Locale-Code ein.\nDrücke Enter, um die Standardsprache beizubehalten: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Gib eine Sprach-Nummer aus der Liste oder einen unterstützten Locale-Code ein.\n",
  "runtime.wizard.language_selected": "Ausgewählte Sprache: {language}\n",
  "runtime.wizard.token_required": "Token ist erforderlich. Bitte versuche es erneut.\n",
  "runtime.wizard.token_invalid":
    "Token sieht ungültig aus (erwartetes Format <id>:<secret>). Bitte versuche es erneut.\n",
  "runtime.wizard.ask_user_id":
    "Gib deine Telegram User ID ein (du bekommst sie bei @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Gib eine positive ganze Zahl ein (> 0).\n",
  "runtime.wizard.ask_api_url":
    "OpenCode API URL eingeben (optional).\nEnter drücken für Standard: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "OpenCode-Server-Benutzername eingeben (optional).\nEnter drücken für Standard: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "OpenCode-Server-Passwort eingeben (optional).\nEnter drücken, um es leer zu lassen.\n> ",
  "runtime.wizard.api_url_invalid":
    "Gib eine gültige URL (http/https) ein oder drücke Enter für Standard.\n",
  "runtime.wizard.start": "OpenCode Telegram Bot Einrichtung.\n",
  "runtime.wizard.saved": "Konfiguration gespeichert:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Anwendung ist noch nicht konfiguriert. Starte Assistent...\n",
  "runtime.wizard.tty_required":
    "Der interaktive Assistent erfordert ein TTY-Terminal. Führe `opencode-telegram config` in einer interaktiven Shell aus.",

  "rename.no_session": "⚠️ Keine aktive Sitzung. Erstelle oder wähle zuerst eine Sitzung.",
  "rename.prompt": "📝 Neuen Titel für die Sitzung eingeben:\n\nAktuell: {title}",
  "rename.empty_title": "⚠️ Titel darf nicht leer sein.",
  "rename.success": "✅ Sitzung umbenannt in: {title}",
  "rename.error": "🔴 Sitzung konnte nicht umbenannt werden.",
  "rename.cancelled": "❌ Umbenennen abgebrochen.",
  "rename.inactive_callback": "Umbenennen-Anfrage ist inaktiv",
  "rename.inactive": "⚠️ Umbenennen-Anfrage ist nicht aktiv. Starte /rename erneut.",
  "rename.blocked.expected_name":
    "⚠️ Sende den neuen Sitzungsnamen als Text oder tippe in der Umbenennen-Nachricht auf Abbrechen.",
  "rename.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist nicht verfügbar, solange beim Umbenennen auf einen neuen Namen gewartet wird.",
  "rename.button.cancel": "❌ Abbrechen",

  "task.prompt.schedule":
    "⏰ Sende den Zeitplan der Aufgabe in natürlicher Sprache.\n\nBeispiele:\n- alle 5 Minuten\n- jeden Tag um 17:00\n- morgen um 12:00",
  "task.schedule_empty": "⚠️ Der Zeitplan darf nicht leer sein.",
  "task.parse.in_progress": "⏳ Zeitplan wird verarbeitet...",
  "task.parse_error":
    "🔴 Zeitplan konnte nicht erkannt werden.\n\n{message}\n\nSende den Zeitraum bitte noch einmal klarer formuliert.",
  "task.schedule_preview":
    "✅ Zeitplan erkannt\n\nVerstanden als: {summary}\n{cronLine}Zeitzone: {timezone}\nTyp: {kind}\nNächster Lauf: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 Sende jetzt, was der Bot nach Zeitplan tun soll.",
  "task.prompt_empty": "⚠️ Der Aufgabentext darf nicht leer sein.",
  "task.created":
    "✅ Geplante Aufgabe erstellt\n\nAufgabe: {description}\nProjekt: {project}\nModell: {model}\nZeitplan: {schedule}\n{cronLine}Nächster Lauf: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 Zeitplan neu eingeben",
  "task.button.cancel": "❌ Abbrechen",
  "task.retry_schedule_callback": "Zeitplaneingabe wird zurückgesetzt...",
  "task.cancel_callback": "Abbruch...",
  "task.cancelled": "❌ Erstellung der geplanten Aufgabe abgebrochen.",
  "task.inactive_callback": "Dieser Ablauf für geplante Aufgaben ist nicht mehr aktiv",
  "task.inactive": "⚠️ Die Erstellung geplanter Aufgaben ist nicht aktiv. Starte /task erneut.",
  "task.blocked.expected_input":
    "⚠️ Schließe zuerst die aktuelle geplante Aufgabe ab: Sende Text oder nutze die Schaltfläche in der Zeitplan-Nachricht.",
  "task.blocked.command_not_allowed":
    "⚠️ Dieser Befehl ist nicht verfügbar, solange die Erstellung einer geplanten Aufgabe aktiv ist.",
  "task.limit_reached":
    "⚠️ Aufgabenlimit erreicht ({limit}). Lösche zuerst eine bestehende geplante Aufgabe.",
  "task.schedule_too_frequent":
    "Der wiederkehrende Zeitplan ist zu häufig. Das minimale erlaubte Intervall ist einmal alle 5 Minuten.",
  "task.kind.cron": "wiederkehrend",
  "task.kind.once": "einmalig",
  "task.run.success": "⏰ Geplante Aufgabe abgeschlossen: {description}",
  "task.run.error": "🔴 Geplante Aufgabe fehlgeschlagen: {description}\n\nFehler: {error}",
  "task.run.error.interactive_question":
    "Die geplante Aufgabe hat eine interaktive Frage gestellt und kann unbeaufsichtigt nicht fortfahren.",
  "task.run.error.interactive_permission":
    "Die geplante Aufgabe hat eine interaktive Berechtigung angefordert und kann unbeaufsichtigt nicht fortfahren.",

  "tasklist.empty": "📭 Noch keine geplanten Aufgaben.",
  "tasklist.select": "Wähle eine geplante Aufgabe:",
  "tasklist.details":
    "⏰ Geplante Aufgabe\n\nAufgabe: {prompt}\nProjekt: {project}\nZeitplan: {schedule}\n{cronLine}Zeitzone: {timezone}\nNächster Lauf: {nextRunAt}\nLetzter Lauf: {lastRunAt}\nAnzahl Läufe: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 Löschen",
  "tasklist.button.cancel": "❌ Abbrechen",
  "tasklist.deleted_callback": "Gelöscht",
  "tasklist.cancelled_callback": "Abgebrochen",
  "tasklist.inactive_callback": "Dieses Menü für geplante Aufgaben ist inaktiv",
  "tasklist.load_error": "🔴 Geplante Aufgaben konnten nicht geladen werden.",

  "commands.select": "Wähle einen OpenCode-Befehl:",
  "commands.empty": "📭 Für dieses Projekt sind keine OpenCode-Befehle verfügbar.",
  "commands.fetch_error": "🔴 OpenCode-Befehle konnten nicht geladen werden.",
  "commands.no_description": "Keine Beschreibung",
  "commands.button.execute": "✅ Ausführen",
  "commands.button.cancel": "❌ Abbrechen",
  "commands.confirm":
    "Bestätige die Ausführung des Befehls {command}. Für die Ausführung mit Argumenten sende die Argumente als Nachricht.",
  "commands.inactive_callback": "Dieses Befehlsmenü ist inaktiv",
  "commands.cancelled_callback": "Abgebrochen",
  "commands.execute_callback": "Befehl wird ausgeführt...",
  "commands.executing_prefix": "⚡ Befehl wird ausgeführt:",
  "commands.arguments_empty":
    "⚠️ Argumente dürfen nicht leer sein. Sende Text oder tippe auf Ausführen.",
  "commands.execute_error": "🔴 OpenCode-Befehl konnte nicht ausgeführt werden.",
  "commands.select_page": "Wähle einen OpenCode-Befehl (Seite {page}):",
  "commands.button.prev_page": "⬅️ Zurück",
  "commands.button.next_page": "Weiter ➡️",
  "commands.page_empty_callback": "Keine Befehle auf dieser Seite",
  "commands.page_load_error_callback":
    "Diese Seite konnte nicht geladen werden. Bitte versuche es erneut.",

  "skills.select": "Wähle einen OpenCode-Skill:",
  "skills.empty": "📭 Für dieses Projekt sind keine OpenCode-Skills verfügbar.",
  "skills.fetch_error": "🔴 OpenCode-Skills konnten nicht geladen werden.",
  "skills.no_description": "Keine Beschreibung",
  "skills.button.execute": "✅ Ausführen",
  "skills.button.cancel": "❌ Abbrechen",
  "skills.confirm":
    "Bestätige die Ausführung des Skills {skill}. Für die Ausführung mit Argumenten sende die Argumente als Nachricht.",
  "skills.inactive_callback": "Dieses Skill-Menü ist inaktiv",
  "skills.cancelled_callback": "Abgebrochen",
  "skills.execute_callback": "Skill wird verwendet...",
  "skills.executing_prefix": "⚡ Skill wird verwendet:",
  "skills.arguments_empty":
    "⚠️ Argumente dürfen nicht leer sein. Sende Text oder tippe auf Ausführen.",
  "skills.select_page": "Wähle einen OpenCode-Skill (Seite {page}):",
  "skills.button.prev_page": "⬅️ Zurück",
  "skills.button.next_page": "Weiter ➡️",
  "skills.page_empty_callback": "Keine Skills auf dieser Seite",
  "skills.page_load_error_callback":
    "Diese Seite konnte nicht geladen werden. Bitte versuche es erneut.",

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

  "cmd.description.rename": "Aktuelle Sitzung umbenennen",

  "legacy.models.fetch_error":
    "🔴 Modellliste konnte nicht geladen werden. Prüfe den Serverstatus mit /status.",
  "legacy.models.empty": "📋 Keine verfügbaren Modelle. Konfiguriere Provider in OpenCode.",
  "legacy.models.header": "📋 Verfügbare Modelle:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ Keine verfügbaren Modelle\n",
  "legacy.models.env_hint": "💡 Um ein Modell in .env zu nutzen:\n",
  "legacy.models.error": "🔴 Beim Laden der Modellliste ist ein Fehler aufgetreten.",

  "stt.recognizing": "🎤 Erkenne Audio...",
  "stt.recognized": "🎤 Erkannt:\n{text}",
  "stt.not_configured":
    "🎤 Spracherkennung ist nicht konfiguriert.\n\nSetze STT_API_URL und STT_API_KEY in .env, um sie zu aktivieren.",
  "stt.error": "🔴 Audio konnte nicht erkannt werden: {error}",
  "stt.empty_result": "🎤 Keine Sprache in der Audionachricht erkannt.",

  "cmd.description.open": "Projekt durch Ordner-Auswahl hinzufügen",
  "worktree.branch_detached": "detached HEAD",
  "worktree.select_with_current": "Worktree auswählen:",
  "worktree.project_not_selected":
    "🏗 Es ist kein Projekt ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "worktree.not_git_repo":
    "🌿 Git-Worktrees sind für das aktuelle Projekt nicht verfügbar. Wähle zuerst ein Git-Repository.",
  "worktree.not_git_repo_callback": "Aktuelles Projekt ist kein Git-Repository",
  "worktree.empty": "📭 Für das aktuelle Repository wurden keine Git-Worktrees gefunden.",
  "worktree.fetch_error": "🔴 Git-Worktrees konnten nicht geladen werden.",
  "worktree.page_empty_callback": "Keine Worktrees auf dieser Seite",
  "worktree.selection_missing_callback": "Der ausgewählte Worktree ist nicht mehr verfügbar",
  "worktree.already_selected_callback": "Dieser Worktree ist bereits ausgewählt",
  "worktree.selected":
    "✅ Worktree ausgewählt: {worktree}\n\n📋 Die Sitzung wurde zurückgesetzt. Nutze /sessions oder /new, um fortzufahren.",
  "worktree.select_error": "🔴 Worktree konnte nicht ausgewählt werden.",
  "open.back": "⬆️ Hoch",
  "open.roots": "📋 Zurück zur Auswahl",
  "open.prev_page": "⬅️ Zurück",
  "open.next_page": "Weiter ➡️",
  "open.select_current": "✅ Diesen Ordner wählen",
  "open.select_root": "📂 Stammverzeichnis zum Durchsuchen wählen:",
  "open.access_denied": "⛔ Zugriff verweigert: Pfad liegt außerhalb erlaubter Verzeichnisse",
  "open.scan_error": "🔴 Verzeichnis kann nicht durchsucht werden: {error}",
  "open.open_error": "🔴 Verzeichnisbrowser konnte nicht geöffnet werden.",
  "open.selected":
    "✅ Projekt hinzugefügt: {project}\n\n📋 Verwende /sessions oder /new zum Arbeiten.",
  "open.select_error": "🔴 Projekt konnte nicht hinzugefügt werden.",
  "open.no_subfolders": "📭 Keine Unterordner",
  "open.subfolder_count": "{count} Unterordner",
  "open.subfolders_count": "{count} Unterordner",

  "cmd.description.session_delete": "Sitzungen löschen",

  "session_delete.project_not_selected":
    "🏗 Es ist kein Projekt ausgewählt.\n\nWähle zuerst ein Projekt mit /projects.",
  "session_delete.empty": "📭 Keine Sitzungen gefunden.\n\nErstelle eine neue Sitzung mit /new.",
  "session_delete.select": "Wähle eine Sitzung zum Löschen:",
  "session_delete.select_page": "Wähle eine Sitzung zum Löschen (Seite {page}):",
  "session_delete.button.delete": "🗑 Löschen",
  "session_delete.button.cancel": "❌ Abbrechen",
  "session_delete.button.prev_page": "⬅️ Zurück",
  "session_delete.button.next_page": "Weiter ➡️",
  "session_delete.details":
    "Sitzung: {title}\nVerzeichnis: {directory}\nErstellt: {date}\n\nDiese Sitzung löschen?",
  "session_delete.deleted": "🗑 Sitzung gelöscht: {title}",
  "session_delete.deleted_current":
    "🗑 Aktuelle Sitzung gelöscht: {title}\n\nVerwende /sessions oder /new zum Fortfahren.",
  "session_delete.cancelled_callback": "Abgebrochen",
  "session_delete.inactive_callback": "Dieses Menü ist inaktiv",
  "session_delete.load_error": "🔴 Sitzungen konnten nicht geladen werden.",
  "session_delete.delete_error": "🔴 Sitzung konnte nicht gelöscht werden.",
  "session_delete.page_empty_callback": "Keine Sitzungen auf dieser Seite",
  "session_delete.page_load_error_callback": "Diese Seite kann nicht geladen werden. Bitte versuche es erneut.",
};
