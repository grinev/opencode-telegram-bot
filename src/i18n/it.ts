import type { I18nDictionary } from "./en.js";

export const it: I18nDictionary = {
  "cmd.description.status": "Stato del server e della sessione",
  "cmd.description.new": "Crea una nuova sessione",
  "cmd.description.stop": "Interrompi l'azione corrente",
  "cmd.description.detach": "Scollega la sessione corrente",
  "cmd.description.sessions": "Elenca le sessioni",
  "cmd.description.messages": "Consulta i messaggi della sessione",
  "cmd.description.settings": "Modifica le impostazioni del bot",
  "cmd.description.projects": "Elenca i progetti",
  "cmd.description.worktree": "Cambia i worktree git",
  "cmd.description.task": "Crea un'attività pianificata",
  "cmd.description.tasklist": "Elenca le attività pianificate",
  "cmd.description.commands": "Comandi personalizzati",
  "cmd.description.skills": "Catalogo delle skill",
  "cmd.description.mcps": "Server MCP",
  "cmd.description.opencode_start": "Avvia il server OpenCode",
  "cmd.description.opencode_stop": "Ferma il server OpenCode",
  "cmd.description.ls": "Elenca il contenuto della directory",
  "cmd.description.help": "Aiuto",

  "callback.unknown_command": "Comando sconosciuto",
  "callback.processing_error": "Errore di elaborazione",

  "error.load_agents": "❌ Impossibile caricare l'elenco degli agenti",
  "error.load_models": "❌ Impossibile caricare l'elenco dei modelli",
  "error.load_variants": "❌ Impossibile caricare l'elenco delle varianti",
  "error.context_button": "❌ Impossibile elaborare il pulsante del contesto",
  "error.generic": "🔴 Qualcosa è andato storto.",

  "interaction.blocked.expired":
    "⚠️ Questa interazione è scaduta. Avviala di nuovo.",
  "interaction.blocked.expected_callback":
    "⚠️ Usa i pulsanti in linea per questo passaggio oppure premi Annulla.",
  "interaction.blocked.expected_text": "⚠️ Invia un messaggio di testo per questo passaggio.",
  "interaction.blocked.expected_command": "⚠️ Invia un comando per questo passaggio.",
  "interaction.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile nel passaggio corrente.",
  "interaction.blocked.finish_current":
    "⚠️ Termina prima l'interazione corrente (rispondi o annulla), poi apri un altro menu.",

  "inline.blocked.expected_choice":
    "⚠️ Scegli un'opzione usando i pulsanti in linea oppure premi Annulla.",
  "inline.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile mentre il menu in linea è attivo.",

  "question.blocked.expected_answer":
    "⚠️ Rispondi alla domanda corrente usando i pulsanti, la risposta personalizzata o Annulla.",
  "question.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile finché il flusso della domanda corrente non è completato.",

  "inline.button.cancel": "❌ Annulla",
  "inline.button.close": "❌ Chiudi",
  "inline.inactive_callback": "Questo menu non è attivo",
  "inline.cancelled_callback": "Annullato",

  "common.unknown": "sconosciuto",
  "common.unknown_error": "errore sconosciuto",

  "start.welcome":
    "👋 Benvenuto in OpenCode Telegram Bot!\n\nUsa i comandi:\n/projects — seleziona il progetto\n/sessions — elenco sessioni\n/new — nuova sessione\n/commands — comandi personalizzati\n/skills — catalogo delle skill\n/task — attività pianificata\n/tasklist — attività pianificate\n/status — stato\n/help — aiuto\n\nUsa i pulsanti in basso per selezionare agente, modello e variante.",
  "help.keyboard_hint":
    "💡 Usa i pulsanti della tastiera in basso per le azioni di agente, modello, variante e contesto.",
  "help.text":
    "📖 **Aiuto**\n\n/status - Verifica lo stato del server\n/sessions - Elenco sessioni\n/new - Crea nuova sessione\n/help - Aiuto",

  "bot.thinking": "💭 Sto pensando...",
  "progress.compact.activity": "{header}\n{activity}",
  "progress.compact.working_header": "⏳ Al lavoro",
  "progress.compact.finished_header": "✅ Lavoro completato",
  "progress.compact.thinking": "💭 Sto pensando...",
  "progress.compact.responding": "✍️ Scrivo la risposta...",
  "progress.compact.waiting_question": "❓ In attesa della tua risposta...",
  "progress.compact.waiting_permission": "🔐 In attesa del permesso...",
  "progress.compact.retrying": "🔁 Nuovo tentativo...",
  "progress.compact.task": "🤖 Attività in esecuzione",
  "progress.compact.done":
    "{header}\nchiamate strumenti: {tools} · file modificati: {files}",
  "bot.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "bot.creating_session": "🔄 Creo una nuova sessione...",
  "bot.create_session_error":
    "🔴 Impossibile creare la sessione. Prova con /new o verifica lo stato del server con /status.",
  "bot.session_created": "✅ Sessione creata: {title}",
  "bot.session_busy":
    "⏳ L'agente sta già eseguendo un'attività. Attendi il completamento o usa /abort per interrompere l'esecuzione.",
  "bot.session_reset_project_mismatch":
    "⚠️ La sessione attiva non corrisponde al progetto selezionato, quindi è stata reimpostata. Usa /sessions per sceglierne una o /new per crearne una nuova.",
  "bot.prompt_send_error": "Invio della richiesta a OpenCode non riuscito.",
  "bot.session_error": "🔴 OpenCode ha restituito un errore: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nIl provider restituisce sempre lo stesso errore dopo ripetuti tentativi. Usa /abort per annullare.",
  "bot.external_user_input": "Input utente esterno",
  "background.session_fallback": "sessione {id}",
  "background.assistant_response":
    "🔔 L'assistente ha risposto nella sessione in background: {session}",
  "background.question_asked":
    "❓ La sessione in background richiede una risposta: {session}",
  "background.permission_asked":
    "🔐 La sessione in background richiede permessi: {session}",
  "background.open_session_button": "Apri la sessione",
  "bot.unknown_command":
    "⚠️ Comando sconosciuto: {command}. Usa /help per vedere i comandi disponibili.",
  "bot.photo_downloading": "⏳ Scarico la foto...",
  "bot.photo_too_large": "⚠️ La foto è troppo grande (max {maxSizeMb}MB)",
  "bot.photo_model_no_image":
    "⚠️ Il modello corrente non supporta le immagini. Invio solo testo.",
  "bot.photo_download_error": "🔴 Download della foto non riuscito",
  "bot.photo_no_caption":
    "💡 Suggerimento: aggiungi una didascalia per descrivere cosa vuoi fare con questa foto.",
  "bot.file_downloading": "⏳ Scarico il file...",
  "bot.files_downloading": "⏳ Scarico i file...",
  "bot.file_too_large": "⚠️ Il file è troppo grande (max {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 Download del file non riuscito",
  "bot.file_type_unsupported":
    "⚠️ Questo tipo di file non è supportato. Invia un'immagine, un documento (PDF, DOCX, PPTX) o un file di testo/codice.",
  "bot.media_group_not_processed":
    "⚠️ Uno o più file di questo album non possono essere elaborati. Nulla è stato inviato a OpenCode.",
  "bot.media_group_download_error":
    "🔴 Download di uno dei file non riuscito. Nulla è stato inviato a OpenCode.",
  "bot.model_no_pdf":
    "⚠️ Il modello corrente non supporta l'input PDF. Invio solo testo.",
  "bot.document_extraction_error": "🔴 Estrazione del testo del documento non riuscita.",
  "bot.text_file_too_large": "⚠️ Il file di testo è troppo grande (max {maxSizeKb}KB)",

  "status.header_running": "🟢 Il server OpenCode è in esecuzione",
  "status.health.healthy": "Sano",
  "status.health.unhealthy": "Non sano",
  "status.line.health": "Stato: {health}",
  "status.line.version": "Versione: {version}",
  "status.line.managed_yes": "Avviato dal bot: Sì",
  "status.line.managed_no": "Avviato dal bot: No",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Tempo di attività: {seconds} sec",
  "status.line.mode": "Agente: {mode}",
  "status.line.model": "Modello: {model}",
  "status.line.tts": "Risposte audio: {tts}",
  "status.tts.off": "Spento",
  "status.tts.all": "Tutte",
  "status.tts.auto": "Automatico",
  "status.agent_not_set": "non impostato",
  "status.project_selected": "Progetto: {project}",
  "status.worktree_selected": "Worktree: {worktree}",
  "status.project_not_selected": "Progetto: non selezionato",
  "status.project_hint": "Usa /projects per selezionare un progetto",
  "status.session_selected": "Sessione corrente: {title}",
  "status.session_not_selected": "Sessione corrente: non selezionata",
  "status.session_hint": "Usa /sessions per selezionarne una o /new per crearne una",
  "status.server_unavailable":
    "🔴 Il server OpenCode non è disponibile\n\nUsa /opencode_start per avviare il server.",

  "tts.off": "🔇 Risposte audio disattivate.",
  "tts.all": "🔊 Risposte audio attivate per tutti i messaggi.",
  "tts.auto": "🎤 Risposte audio attivate solo per i messaggi vocali/audio.",
  "tts.not_configured":
    "⚠️ Le risposte audio non sono disponibili. Imposta prima `TTS_API_URL` e `TTS_API_KEY`.",
  "tts.failed": "⚠️ Generazione della risposta audio non riuscita.",

  "settings.menu.title": "⚙️ Impostazioni del bot\nPremi su un'impostazione per cambiarne il valore:",
  "settings.compact_output.label": "Modalità output compatta",
  "settings.thinking_content.label": "Contenuto del pensiero",
  "settings.response_streaming.label": "Streaming della risposta",
  "settings.response_streaming.edit": "modifica",
  "settings.response_streaming.draft": "bozza (sperimentale)",
  "settings.diff_files.label": "File di diff",
  "settings.assistant_footer.label": "Footer dell'assistente",
  "settings.tts.label": "Risposte audio",
  "settings.prompt_queue.label": "Coda messaggi",
  "settings.value.on": "Attivo",
  "settings.value.off": "Spento",
  "settings.saved": "✅ Impostazione salvata.",

  "projects.empty":
    "📭 Nessun progetto trovato.\n\nApri una directory in OpenCode e crea almeno una sessione: poi apparirà qui.",
  "projects.select": "Seleziona un progetto:",
  "projects.select_with_current": "Seleziona un progetto:\n\nCorrente: 🏗 {project}",
  "projects.page_indicator": "Pagina {current}/{total}",
  "projects.prev_page": "⬅️ Precedente",
  "projects.next_page": "Successiva ➡️",
  "projects.fetch_error":
    "🔴 Il server OpenCode non è disponibile o si è verificato un errore durante il caricamento dei progetti.",
  "projects.page_load_error": "Impossibile caricare questa pagina. Riprova.",
  "projects.selected":
    "✅ Progetto selezionato: {project}\n\n📋 La sessione è stata reimpostata. Usa /sessions o /new per questo progetto.",
  "projects.select_error": "🔴 Selezione del progetto non riuscita.",

  "sessions.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "sessions.empty": "📭 Nessuna sessione trovata.\n\nCrea una nuova sessione con /new.",
  "sessions.select": "Seleziona una sessione:",
  "sessions.select_page": "Seleziona una sessione (pagina {page}):",
  "sessions.fetch_error":
    "🔴 Il server OpenCode non è disponibile o si è verificato un errore durante il caricamento delle sessioni.",
  "sessions.select_project_first": "🔴 Nessun progetto selezionato. Usa /projects.",
  "sessions.page_empty_callback": "Nessuna sessione in questa pagina",
  "sessions.page_load_error_callback": "Impossibile caricare questa pagina. Riprova.",
  "sessions.button.prev_page": "⬅️ Prec",
  "sessions.button.next_page": "Succ ➡️",
  "sessions.loading_context": "⏳ Carico contesto e messaggi recenti...",
  "sessions.selected": "✅ Sessione selezionata: {title}",
  "sessions.select_error": "🔴 Selezione della sessione non riuscita.",
  "sessions.preview.empty": "Nessun messaggio recente.",
  "sessions.preview.title": "Messaggi recenti:",
  "sessions.preview.you": "Tu:",
  "sessions.preview.agent": "Agente:",

  "messages.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "messages.session_not_selected":
    "💬 Nessuna sessione selezionata.\n\nScegli prima una sessione con /sessions o creane una con /new.",
  "messages.session_project_mismatch":
    "⚠️ La sessione selezionata non corrisponde al progetto corrente. Scegli di nuovo la sessione tramite /sessions.",
  "messages.empty": "📭 Nessun messaggio utente nella sessione corrente.",
  "messages.select": "Scegli un messaggio:",
  "messages.select_page": "Scegli un messaggio (pagina {page}):",
  "messages.fetch_error":
    "🔴 Il server OpenCode non è disponibile o si è verificato un errore durante il caricamento dei messaggi.",
  "messages.inactive_callback": "Questo menu dei messaggi non è attivo",
  "messages.cancelled_callback": "Annullato",
  "messages.page_empty_callback": "Nessun messaggio in questa pagina",
  "messages.button.prev_page": "⬅️ Prec",
  "messages.button.next_page": "Succ ➡️",
  "messages.button.revert": "↩️ Ripristina",
  "messages.button.fork": "🔀 Fork",
  "messages.button.back": "⬅️ Indietro",
  "messages.button.cancel": "❌ Annulla",
  "messages.revert_success": "✅ Ripristinato al messaggio:\n\n{text}",
  "messages.revert_error": "❌ Ripristino del messaggio non riuscito. Riprova.",
  "messages.fork_success": "🔀 Fork creato dal messaggio:\n\n{text}",
  "messages.fork_error": "❌ Creazione del fork non riuscita. Riprova.",

  "attach.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "attach.session_not_selected":
    "💬 Nessuna sessione selezionata.\n\nScegli prima una sessione con /sessions.",
  "attach.session_project_mismatch":
    "⚠️ La sessione selezionata non corrisponde al progetto corrente. Scegli di nuovo la sessione tramite /sessions.",
  "attach.connected": "✅ Connesso alla sessione: {title}",
  "attach.already_connected": "ℹ️ Già connesso alla sessione: {title}",
  "attach.status.idle_message": "Stato: inattivo. In attesa di nuovi eventi.",
  "attach.status.busy_message": "Stato: occupato. I nuovi prompt sono temporaneamente bloccati.",
  "attach.restored_question": "Ripristinata una domanda in sospeso per questa sessione.",
  "attach.restored_permissions": "Ripristinate richieste di permesso in sospeso: {count}.",
  "attach.disconnect_hint": "Per scollegarti, passa a un'altra sessione o progetto.",
  "attach.error": "🔴 Connessione alla sessione corrente non riuscita.",

  "detach.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "detach.no_active_session": "ℹ️ Il bot non è connesso ad alcuna sessione.",
  "detach.success":
    "✅ Scollegato dalla sessione: {title}\n\nLa sessione OpenCode non è stata fermata. Se è ancora in esecuzione, continuerà separatamente. Per verificarla in seguito, selezionala di nuovo tramite /sessions.",
  "detach.error": "🔴 Scollegamento dalla sessione corrente non riuscito.",

  "new.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "new.created": "✅ Nuova sessione creata: {title}",
  "new.create_error":
    "🔴 Il server OpenCode non è disponibile o si è verificato un errore durante la creazione della sessione.",

  "stop.no_active_session":
    "🛑 L'agente non è stato avviato\n\nCrea una sessione con /new o selezionane una tramite /sessions.",
  "stop.in_progress":
    "🛑 Flusso di eventi interrotto, invio del segnale di annullamento...\n\nIn attesa che l'agente si fermi.",
  "stop.warn_unconfirmed":
    "⚠️ Flusso di eventi interrotto, ma il server non ha confermato l'annullamento.\n\nControlla /status e riprova /abort tra qualche secondo.",
  "stop.warn_maybe_finished":
    "⚠️ Flusso di eventi interrotto, ma l'agente potrebbe aver già terminato.",
  "stop.success": "✅ Azione dell'agente interrotta. Non verranno più inviati messaggi da questa esecuzione.",
  "stop.warn_still_busy":
    "⚠️ Segnale inviato, ma l'agente è ancora occupato.\n\nIl flusso di eventi è già disattivato, quindi non verranno inviati messaggi intermedi.",
  "stop.warn_timeout":
    "⚠️ Timeout della richiesta di annullamento.\n\nIl flusso di eventi è già disattivato, riprova /abort tra qualche secondo.",
  "stop.warn_local_only": "⚠️ Flusso di eventi interrotto localmente, ma l'annullamento lato server non è riuscito.",
  "stop.error": "🔴 Interruzione dell'azione non riuscita.\n\nIl flusso di eventi è fermo, riprova /abort.",

  "opencode_start.already_running_managed":
    "⚠️ Il server OpenCode è già in esecuzione\n\nPID: {pid}\nTempo di attività: {seconds} secondi",
  "opencode_start.already_running_external":
    "✅ Il server OpenCode è già in esecuzione come processo esterno\n\nVersione: {version}\n\nQuesto server non è stato avviato dal bot, quindi /opencode-stop non può fermarlo.",
  "opencode_start.already_running": "✅ Il server OpenCode è già in esecuzione\n\nVersione: {version}",
  "opencode_start.remote_configured": "⚠️ /opencode_start funziona solo con un server OpenCode locale.",
  "opencode_start.starting": "🔄 Avvio del server OpenCode...",
  "opencode_start.start_error":
    "🔴 Avvio del server OpenCode non riuscito\n\nErrore: {error}\n\nControlla che la CLI OpenCode sia installata e disponibile nel PATH:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ Il server OpenCode è stato avviato, ma non risponde\n\nPID: {pid}\n\nIl server potrebbe essere ancora in fase di avvio. Prova /status tra qualche secondo.",
  "opencode_start.success":
    "✅ Server OpenCode avviato correttamente\n\nPID: {pid}\nVersione: {version}",
  "opencode_start.error":
    "🔴 Si è verificato un errore durante l'avvio del server.\n\nControlla i log dell'applicazione per i dettagli.",
  "opencode_stop.external_running":
    "⚠️ Il server OpenCode è in esecuzione come processo esterno\n\nQuesto server non è stato avviato tramite /opencode-start.\nFermalo manualmente o usa /status per controllarne lo stato.",
  "opencode_stop.remote_configured": "⚠️ /opencode_stop funziona solo con un server OpenCode locale.",
  "opencode_stop.not_running": "⚠️ Il server OpenCode non è in esecuzione",
  "opencode_stop.pid_not_found":
    "⚠️ Il server OpenCode risponde sulla porta {port}, ma non è stato trovato alcun processo locale da fermare.",
  "opencode_stop.stopping": "🛑 Sto fermando il server OpenCode...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 Arresto del server OpenCode non riuscito\n\nErrore: {error}",
  "opencode_stop.still_running": "Il server risponde ancora dopo la richiesta di arresto.",
  "opencode_stop.success": "✅ Server OpenCode arrestato correttamente",
  "opencode_stop.error":
    "🔴 Si è verificato un errore durante l'arresto del server.\n\nControlla i log dell'applicazione per i dettagli.",

  "agent.changed_callback": "Agente modificato: {name}",
  "agent.changed_message": "✅ Agente modificato in: {name}",
  "agent.change_error_callback": "Modifica dell'agente non riuscita",
  "agent.menu.current": "Agente corrente: {name}\n\nSeleziona agente:",
  "agent.menu.select": "Seleziona agente:",
  "agent.menu.empty": "⚠️ Nessun agente disponibile",
  "agent.menu.error": "🔴 Recupero dell'elenco degli agenti non riuscito",

  "model.changed_callback": "Modello modificato: {name}",
  "model.changed_message": "✅ Modello modificato in: {name}",
  "model.change_error_callback": "Modifica del modello non riuscita",
  "model.menu.empty": "⚠️ Nessun modello disponibile",
  "model.menu.select": "Seleziona modello:",
  "model.menu.current": "Modello corrente: {name}\n\nSeleziona modello:",
  "model.menu.favorites_title": "⭐ Preferiti (aggiungi modelli ai preferiti nella CLI OpenCode)",
  "model.menu.favorites_empty": "— Vuoto.",
  "model.menu.recent_title": "🕘 Recenti",
  "model.menu.recent_empty": "— Vuoto.",
  "model.menu.favorites_hint":
    "ℹ️ Aggiungi modelli ai preferiti nella CLI OpenCode per tenerli in cima.",
  "model.menu.error": "🔴 Recupero dell'elenco dei modelli non riuscito",
  "model.search.button": "🔍 Cerca",
  "model.search.prompt": "🔍 Inserisci il nome del modello da cercare:",
  "model.search.results_title": 'Risultati della ricerca per "{query}":',
  "model.search.no_results": 'Nessun modello trovato per "{query}"',
  "model.search.search_again": "↩ Cerca di nuovo",
  "model.search.error": "Ricerca non riuscita",
  "model.button.back": "⬅️ Indietro",
  "model.providers.button": "🗂 Provider",
  "model.providers.title": "Seleziona un provider dall'elenco:",
  "model.providers.empty": "⚠️ Nessun provider connesso",
  "model.providers.error": "Recupero dell'elenco dei provider non riuscito",
  "model.providers.page_indicator": "Pagina {current}/{total}",
  "model.providers.prev_page": "⬅️ Precedente",
  "model.providers.next_page": "Successiva ➡️",
  "model.provider_models.title": "{provider} — seleziona modello:",
  "model.provider_models.empty": "⚠️ Nessun modello disponibile per {provider}",
  "model.provider_models.page_indicator": "Pagina {current}/{total}",

  "variant.model_not_selected_callback": "Errore: modello non selezionato",
  "variant.changed_callback": "Variante modificata: {name}",
  "variant.changed_message": "✅ Variante modificata in: {name}",
  "variant.change_error_callback": "Modifica della variante non riuscita",
  "variant.select_model_first": "⚠️ Seleziona prima un modello",
  "variant.menu.empty": "⚠️ Nessuna variante disponibile",
  "variant.menu.current": "Variante corrente: {name}\n\nSeleziona variante:",
  "variant.menu.error": "🔴 Recupero dell'elenco delle varianti non riuscito",

  "context.button.confirm": "✅ Sì, compatta il contesto",
  "context.no_active_session": "⚠️ Nessuna sessione attiva. Crea una sessione con /new",
  "context.confirm_text":
    '📊 Compattazione del contesto per la sessione "{title}"\n\nQuesto ridurrà l\'uso del contesto rimuovendo i vecchi messaggi dalla cronologia. L\'attività corrente non verrà interrotta.\n\nContinuare?',
  "context.callback_session_not_found": "Sessione non trovata",
  "context.callback_compacting": "Compattazione del contesto...",
  "context.progress": "⏳ Compattazione del contesto...",
  "context.error": "❌ Compattazione del contesto non riuscita",
  "context.success": "✅ Contesto compattato correttamente",

  "permission.inactive_callback": "La richiesta di permesso non è attiva",
  "permission.processing_error_callback": "Errore di elaborazione",
  "permission.no_active_request_callback": "Errore: nessuna richiesta attiva",
  "permission.reply.once": "Consentito una volta",
  "permission.reply.always": "Consentito sempre",
  "permission.reply.reject": "Rifiutato",
  "permission.send_reply_error": "❌ Invio della risposta al permesso non riuscito",
  "permission.blocked.expected_reply":
    "⚠️ Rispondi prima alla richiesta di permesso usando i pulsanti qui sopra.",
  "permission.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile finché non rispondi alla richiesta di permesso.",
  "permission.header": "{emoji} Richiesta di permesso: {name}\n\n",
  "permission.grouped_count":
    "\n⚠️ {count} richieste identiche in sospeso: la tua risposta si applicherà a tutte.\n",
  "permission.button.allow": "✅ Consenti una volta",
  "permission.button.always": "🔓 Consenti sempre",
  "permission.button.reject": "❌ Rifiuta",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Modifica",
  "permission.name.write": "Scrittura",
  "permission.name.read": "Lettura",
  "permission.name.webfetch": "Recupero Web",
  "permission.name.websearch": "Ricerca Web",
  "permission.name.glob": "Ricerca File",
  "permission.name.grep": "Ricerca Contenuti",
  "permission.name.list": "Elenca Directory",
  "permission.name.task": "Attività",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "Directory Esterna",

  "question.inactive_callback": "Il sondaggio non è attivo",
  "question.processing_error_callback": "Errore di elaborazione",
  "question.select_one_required_callback": "Seleziona almeno un'opzione",
  "question.enter_custom_callback": "Invia la tua risposta personalizzata come messaggio",
  "question.cancelled": "❌ Sondaggio annullato",
  "question.answer_already_received": "Risposta già ricevuta, attendi...",
  "question.completed_no_answers": "✅ Sondaggio completato (nessuna risposta)",
  "question.no_active_project": "❌ Nessun progetto attivo",
  "question.no_active_request": "❌ Nessuna richiesta attiva",
  "question.send_answers_error": "❌ Invio delle risposte all'agente non riuscito",
  "question.multi_hint": "\n(Puoi selezionare più opzioni)",
  "question.button.submit": "✅ Fine",
  "question.button.custom": "🔤 Risposta personalizzata",
  "question.button.cancel": "❌ Annulla",
  "question.use_custom_button_first":
    '⚠️ Per inviare del testo, premi prima "Risposta personalizzata" per la domanda corrente.',
  "question.summary.title": "✅ Sondaggio completato!\n\n",
  "question.summary.question": "Domanda {index}:\n{question}\n\n",
  "question.summary.answer": "Risposta:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} Agente {name}",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Predefinito",
  "keyboard.queued_prompt": "❌ {index}. {text}",
  "queue.added": "📥 Aggiunto alla coda ({count}/{max}). Verrà inviato quando l'attività corrente termina.",
  "queue.full": "⚠️ La coda è piena ({max}). Rimuovi un messaggio o attendi che l'attività corrente termini.",
  "queue.removed": "🗑 Messaggio rimosso dalla coda.",
  "queue.not_found": "Questo messaggio non è più in coda.",
  "queue.disabled_hint": "La coda dei messaggi può essere attivata in /settings.",
  "keyboard.updated": "⌨️ Tastiera aggiornata",

  "pinned.default_session_title": "nuova sessione",
  "pinned.unknown": "Sconosciuto",
  "pinned.line.project": "Progetto: {project}",
  "pinned.line.worktree": "Worktree: {worktree}",
  "pinned.line.model": "Modello: {model}",
  "pinned.line.attach": "Monitoraggio: {status}",
  "pinned.attach.status.idle": "attivo, inattivo",
  "pinned.attach.status.busy": "attivo, occupato",
  "pinned.line.context": "Contesto: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "Costo: {cost} spesi",
  "subagent.header": "Subagent {agent}: {description}",
  "subagent.line.status": "Stato: {status}",
  "subagent.line.task": "Attività: {task}",
  "subagent.line.agent": "Agente: {agent}",
  "subagent.working": "Al lavoro...",
  "subagent.working_with_details": "Al lavoro: {details}",
  "subagent.completed": "Completato",
  "subagent.failed": "Attività non riuscita",
  "subagent.status.pending": "in attesa",
  "subagent.status.running": "in esecuzione",
  "subagent.status.completed": "completato",
  "subagent.status.error": "errore",
  "pinned.files.title": "File ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... e altri {count}",

  "tool.todo.overflow": "*({count} attività in più)*",
  "tool.file_header.write":
    "Scrittura File/Percorso: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Modifica File/Percorso: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Inserisci il token del bot Telegram (ottienilo da @BotFather).\n> ",
  "runtime.wizard.ask_language":
    "Seleziona la lingua dell'interfaccia.\nInserisci il numero della lingua dall'elenco o il codice della lingua.\nPremi Invio per mantenere la lingua predefinita: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Inserisci un numero di lingua dall'elenco o un codice di lingua supportato.\n",
  "runtime.wizard.language_selected": "Lingua selezionata: {language}\n",
  "runtime.wizard.token_required": "Il token è obbligatorio. Riprova.\n",
  "runtime.wizard.token_invalid":
    "Il token sembra non valido (formato atteso <id>:<secret>). Riprova.\n",
  "runtime.wizard.ask_user_id":
    "Inserisci il tuo ID utente Telegram (puoi ottenerlo da @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Inserisci un intero positivo (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Inserisci l'URL dell'API OpenCode (facoltativo).\nPremi Invio per usare l'impostazione predefinita: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "Inserisci il nome utente del server OpenCode (facoltativo).\nPremi Invio per usare l'impostazione predefinita: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "Inserisci la password del server OpenCode (facoltativa).\nPremi Invio per lasciarla vuota.\n> ",
  "runtime.wizard.api_url_invalid": "Inserisci un URL valido (http/https) o premi Invio per l'impostazione predefinita.\n",
  "runtime.wizard.start": "Configurazione di OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Configurazione salvata:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "L'applicazione non è ancora configurata. Avvio della configurazione...\n",
  "runtime.wizard.tty_required":
    "La configurazione interattiva richiede un terminale TTY. Esegui `opencode-telegram config` in una shell interattiva.",

  "rename.no_session": "⚠️ Nessuna sessione attiva. Crea o seleziona prima una sessione.",
  "rename.prompt": "📝 Inserisci il nuovo titolo della sessione:\n\nCorrente: {title}",
  "rename.empty_title": "⚠️ Il titolo non può essere vuoto.",
  "rename.success": "✅ Sessione rinominata in: {title}",
  "rename.error": "🔴 Rinomina della sessione non riuscita.",
  "rename.cancelled": "❌ Rinomina annullata.",
  "rename.inactive_callback": "La richiesta di rinomina non è attiva",
  "rename.inactive": "⚠️ La richiesta di rinomina non è attiva. Esegui /rename di nuovo.",
  "rename.blocked.expected_name":
    "⚠️ Inserisci un nuovo nome per la sessione come testo oppure premi Annulla nel messaggio di rinomina.",
  "rename.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile mentre la rinomina è in attesa di un nuovo nome.",
  "rename.button.cancel": "❌ Annulla",

  "task.prompt.schedule":
    "⏰ Invia la pianificazione dell'attività in linguaggio naturale.\n\nEsempi:\n- ogni 5 minuti\n- ogni giorno alle 17:00\n- domani alle 12:00",
  "task.schedule_empty": "⚠️ La pianificazione non può essere vuota.",
  "task.parse.in_progress": "⏳ Analisi della pianificazione...",
  "task.parse_error":
    "🔴 Analisi della pianificazione non riuscita.\n\n{message}\n\nInvia di nuovo la pianificazione in una forma più chiara.",
  "task.schedule_preview":
    "✅ Pianificazione analizzata\n\nEcco come l'ho intesa: {summary}\n{cronLine}Fuso orario: {timezone}\nTipo: {kind}\nProssima esecuzione: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 Ora invia cosa deve fare il bot secondo la pianificazione.",
  "task.prompt_empty": "⚠️ Il testo dell'attività non può essere vuoto.",
  "task.created":
    "✅ Attività pianificata creata\n\nAttività: {description}\nProgetto: {project}\nModello: {model}\nPianificazione: {schedule}\n{cronLine}Prossima esecuzione: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 Reinserisci la pianificazione",
  "task.button.cancel": "❌ Annulla",
  "task.retry_schedule_callback": "Reinserimento della pianificazione...",
  "task.cancel_callback": "Annullamento...",
  "task.cancelled": "❌ Creazione dell'attività pianificata annullata.",
  "task.inactive_callback": "Questo flusso di attività pianificata non è attivo",
  "task.inactive": "⚠️ La creazione dell'attività pianificata non è attiva. Esegui /task di nuovo.",
  "task.blocked.expected_input":
    "⚠️ Termina prima la configurazione dell'attività pianificata corrente inviando del testo o usando il pulsante nel messaggio della pianificazione.",
  "task.blocked.command_not_allowed":
    "⚠️ Questo comando non è disponibile mentre la creazione dell'attività pianificata è attiva.",
  "task.limit_reached": "⚠️ Limite di attività raggiunto ({limit}). Elimina prima un'attività pianificata esistente.",
  "task.schedule_too_frequent":
    "La pianificazione ricorrente è troppo frequente. L'intervallo minimo consentito è una volta ogni 5 minuti.",
  "task.kind.cron": "ricorrente",
  "task.kind.once": "una tantum",
  "task.run.success": "⏰ Attività pianificata completata: {description}",
  "task.run.error": "🔴 Attività pianificata non riuscita: {description}\n\nErrore: {error}",
  "task.run.error.interactive_question":
    "L'attività pianificata ha richiesto una domanda interattiva e non può proseguire senza supervisione.",
  "task.run.error.interactive_permission":
    "L'attività pianificata ha richiesto un permesso interattivo e non può proseguire senza supervisione.",

  "tasklist.empty": "📭 Nessuna attività pianificata.",
  "tasklist.select": "Seleziona un'attività pianificata:",
  "tasklist.details":
    "⏰ Attività pianificata\n\nAttività: {prompt}\nProgetto: {project}\nPianificazione: {schedule}\n{cronLine}Fuso orario: {timezone}\nProssima esecuzione: {nextRunAt}\nUltima esecuzione: {lastRunAt}\nNumero di esecuzioni: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 Elimina",
  "tasklist.button.cancel": "❌ Annulla",
  "tasklist.deleted_callback": "Eliminato",
  "tasklist.cancelled_callback": "Annullato",
  "tasklist.inactive_callback": "Questo menu delle attività pianificate non è attivo",
  "tasklist.load_error": "🔴 Caricamento delle attività pianificate non riuscito.",

  "commands.select": "Scegli un comando OpenCode:",
  "commands.empty": "📭 Nessun comando OpenCode disponibile per questo progetto.",
  "commands.fetch_error": "🔴 Caricamento dei comandi OpenCode non riuscito.",
  "commands.no_description": "Nessuna descrizione",
  "commands.button.execute": "✅ Esegui",
  "commands.button.cancel": "❌ Annulla",
  "commands.confirm":
    "Conferma l'esecuzione del comando {command}. Per eseguirlo con argomenti, invia gli argomenti come messaggio.",
  "commands.inactive_callback": "Questo menu dei comandi non è attivo",
  "commands.cancelled_callback": "Annullato",
  "commands.execute_callback": "Esecuzione del comando...",
  "commands.executing_prefix": "⚡ Esecuzione del comando:",
  "commands.arguments_empty": "⚠️ Gli argomenti non possono essere vuoti. Invia del testo o premi Esegui.",
  "commands.execute_error": "🔴 Esecuzione del comando OpenCode non riuscita.",
  "commands.select_page": "Scegli un comando OpenCode (pagina {page}):",
  "commands.button.prev_page": "⬅️ Prec",
  "commands.button.next_page": "Succ ➡️",
  "commands.page_empty_callback": "Nessun comando in questa pagina",
  "commands.page_load_error_callback": "Impossibile caricare questa pagina. Riprova.",
  "commands.download.no_roots": "Nessuna root del browser configurata.",
  "commands.download.downloading": "Download del file...",
  "commands.download.not_found": "File non trovato",
  "commands.download.not_file": "Il percorso non è un file",
  "commands.download.file_too_large": "Il file è troppo grande",
  "commands.download.size": "Dimensione",
  "commands.download.modified": "Modificato",
  "commands.download.error": "Download del file non riuscito.",

  "skills.select": "Scegli una skill OpenCode:",
  "skills.empty": "📭 Nessuna skill OpenCode disponibile per questo progetto.",
  "skills.fetch_error": "🔴 Caricamento delle skill OpenCode non riuscito.",
  "skills.no_description": "Nessuna descrizione",
  "skills.button.execute": "✅ Esegui",
  "skills.button.cancel": "❌ Annulla",
  "skills.confirm":
    "Conferma l'uso della skill {skill}. Per usarla con argomenti, invia gli argomenti come messaggio.",
  "skills.inactive_callback": "Questo menu delle skill non è attivo",
  "skills.cancelled_callback": "Annullato",
  "skills.execute_callback": "Uso della skill...",
  "skills.executing_prefix": "⚡ Uso della skill:",
  "skills.arguments_empty": "⚠️ Gli argomenti non possono essere vuoti. Invia del testo o premi Esegui.",
  "skills.select_page": "Scegli una skill OpenCode (pagina {page}):",
  "skills.button.prev_page": "⬅️ Prec",
  "skills.button.next_page": "Succ ➡️",
  "skills.page_empty_callback": "Nessuna skill in questa pagina",
  "skills.page_load_error_callback": "Impossibile caricare questa pagina. Riprova.",

  "mcps.select": "Server MCP:",
  "mcps.empty": "📭 Nessun server MCP configurato.",
  "mcps.fetch_error": "🔴 Caricamento dei server MCP non riuscito.",
  "mcps.toggle_error": "🔴 Commutazione del server MCP non riuscita.",
  "mcps.enabling": "Abilitazione...",
  "mcps.disabling": "Disabilitazione...",
  "mcps.status.connected": "🟢 Connesso",
  "mcps.status.disabled": "🔴 Disabilitato",
  "mcps.status.failed": "⚠️ Non riuscito",
  "mcps.status.needs_auth": "🔒 Richiede autenticazione",
  "mcps.status.needs_client_registration": "🔒 Richiede registrazione",
  "mcps.detail.title": "Server: {name}",
  "mcps.detail.status": "Stato: {status}",
  "mcps.detail.error": "Errore: {error}",
  "mcps.button.enable": "🟢 Abilita",
  "mcps.button.disable": "🔴 Disabilita",
  "mcps.button.back": "⬅️ Indietro",
  "mcps.auth_required": "Questo server richiede autorizzazione e non può essere abilitato dal bot.",

  "cmd.description.rename": "Rinomina la sessione corrente",

  "legacy.models.fetch_error": "🔴 Recupero dell'elenco dei modelli non riuscito. Controlla lo stato del server con /status.",
  "legacy.models.empty": "📋 Nessun modello disponibile. Configura i provider in OpenCode.",
  "legacy.models.header": "📋 Modelli disponibili:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ Nessun modello disponibile\n",
  "legacy.models.env_hint": "💡 Per usare il modello in .env:\n",
  "legacy.models.error": "🔴 Si è verificato un errore durante il caricamento dell'elenco dei modelli.",

  "stt.recognizing": "🎤 Riconoscimento audio...",
  "stt.recognized": "🎤 Riconosciuto:\n{text}",
  "stt.not_configured":
    "🎤 Il riconoscimento vocale non è configurato.\n\nImposta STT_API_URL e STT_API_KEY in .env per abilitarlo.",
  "stt.error": "🔴 Riconoscimento audio non riuscito: {error}",
  "stt.empty_result": "🎤 Nessun parlato rilevato nel messaggio audio.",

  "cmd.description.open": "Aggiungi un progetto navigando tra le directory",
  "worktree.branch_detached": "HEAD staccato",
  "worktree.select_with_current": "Seleziona un worktree:",
  "worktree.project_not_selected":
    "🏗 Nessun progetto selezionato.\n\nSeleziona prima un progetto con /projects.",
  "worktree.not_git_repo":
    "🌿 I worktree git non sono disponibili per il progetto corrente. Seleziona prima un repository git.",
  "worktree.not_git_repo_callback": "Il progetto corrente non è un repository git",
  "worktree.empty": "📭 Nessun worktree git trovato per il repository corrente.",
  "worktree.fetch_error": "🔴 Caricamento dei worktree git non riuscito.",
  "worktree.page_empty_callback": "Nessun worktree in questa pagina",
  "worktree.selection_missing_callback": "Il worktree selezionato non è più disponibile",
  "worktree.already_selected_callback": "Questo worktree è già selezionato",
  "worktree.selected":
    "✅ Worktree selezionato: {worktree}\n\n📋 La sessione è stata reimpostata. Usa /sessions o /new per continuare.",
  "worktree.select_error": "🔴 Selezione del worktree non riuscita.",
  "open.back": "⬆️ Su",
  "open.roots": "📋 Torna alle root",
  "open.prev_page": "⬅️ Precedente",
  "open.next_page": "Successiva ➡️",
  "open.select_current": "✅ Seleziona questa cartella",
  "open.select_root": "📂 Seleziona una directory root da esplorare:",
  "open.access_denied": "⛔ Accesso negato: il percorso è fuori dalle root consentite",
  "open.scan_error": "🔴 Impossibile esplorare la directory: {error}",
  "open.open_error": "🔴 Apertura dell'esploratore di directory non riuscita.",
  "open.selected": "✅ Progetto aggiunto: {project}\n\n📋 Usa /sessions o /new per iniziare a lavorare.",
  "open.select_error": "🔴 Aggiunta del progetto non riuscita.",
  "open.no_subfolders": "📭 Nessuna sottocartella",
  "open.subfolder_count": "{count} sottocartella",
  "open.subfolders_count": "{count} sottocartelle",
  "ls.access_denied": "⛔ Accesso negato: il percorso è fuori dal progetto corrente",
  "ls.scan_error": "🔴 Impossibile elencare la directory",
  "ls.header": "Elenco della Directory",
  "ls.total": "Totale: {count} elementi",
  "ls.file.header": "Dettagli del File",
  "ls.file.download": "📥 Scarica",
  "ls.file.back": "⬅️ Indietro",
  "ls.file.attach": "📎 Allega al prossimo prompt",
  "attachment.added": "📎 Allegato: {path}\n\nInvia il tuo messaggio e il file verrà incluso.",
  "attachment.cancel": "❌ Annulla allegato",
  "attachment.cancelled": "❌ Allegato annullato",
  "attachment.invalid":
    "⚠️ Il file allegato non è più disponibile. Invio del messaggio senza di esso.",
};
