import type { I18nDictionary } from "./en.js";

export const fr: I18nDictionary = {
  "cmd.description.status": "Statut du serveur et de la session",
  "cmd.description.new": "Créer une nouvelle session",
  "cmd.description.stop": "Arrêter l'action en cours",
  "cmd.description.sessions": "Lister les sessions",
  "cmd.description.projects": "Lister les projets",
  "cmd.description.task": "Créer une tâche planifiée",
  "cmd.description.commands": "Commandes personnalisées",
  "cmd.description.opencode_start": "Démarrer le serveur OpenCode",
  "cmd.description.opencode_stop": "Arrêter le serveur OpenCode",
  "cmd.description.help": "Aide",

  "callback.unknown_command": "Commande inconnue",
  "callback.processing_error": "Erreur de traitement",

  "error.load_agents": "❌ Impossible de charger la liste des modes",
  "error.load_models": "❌ Impossible de charger la liste des modèles",
  "error.load_variants": "❌ Impossible de charger la liste des variantes",
  "error.context_button": "❌ Impossible de traiter le bouton de contexte",
  "error.generic": "🔴 Une erreur s'est produite.",

  "interaction.blocked.expired": "⚠️ Cette interaction a expiré. Veuillez la relancer.",
  "interaction.blocked.expected_callback":
    "⚠️ Veuillez utiliser les boutons inline pour cette étape ou appuyer sur Annuler.",
  "interaction.blocked.expected_text": "⚠️ Veuillez envoyer un message texte pour cette étape.",
  "interaction.blocked.expected_command": "⚠️ Veuillez envoyer une commande pour cette étape.",
  "interaction.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible à l'étape actuelle.",
  "interaction.blocked.finish_current":
    "⚠️ Terminez d'abord l'interaction en cours (réponse ou annulation), puis ouvrez un autre menu.",

  "inline.blocked.expected_choice":
    "⚠️ Choisissez une option avec les boutons inline ou appuyez sur Annuler.",
  "inline.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible tant que le menu inline est actif.",

  "question.blocked.expected_answer":
    "⚠️ Répondez à la question en cours avec les boutons, Réponse personnalisée ou Annuler.",
  "question.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible tant que le flux de question actuel n'est pas terminé.",

  "inline.button.cancel": "❌ Annuler",
  "inline.inactive_callback": "Ce menu est inactif",
  "inline.cancelled_callback": "Annulé",

  "common.unknown": "inconnu",
  "common.unknown_error": "erreur inconnue",

  "start.welcome":
    "👋 Bienvenue dans OpenCode Telegram Bot !\n\nUtilisez les commandes :\n/projects — sélectionner un projet\n/sessions — liste des sessions\n/new — nouvelle session\n/task — tâche planifiée\n/status — statut\n/help — aide\n\nUtilisez les boutons du bas pour choisir le mode d'agent, le modèle et la variante.",
  "help.keyboard_hint":
    "💡 Utilisez les boutons du bas pour le mode d'agent, le modèle, la variante et les actions de contexte.",
  "help.text":
    "📖 **Aide**\n\n/status - Vérifier l'état du serveur\n/sessions - Liste des sessions\n/new - Créer une nouvelle session\n/help - Aide",

  "bot.thinking": "💭 Réflexion en cours...",
  "bot.project_not_selected":
    "🏗 Aucun projet n'est sélectionné.\n\nSélectionnez d'abord un projet avec /projects.",
  "bot.creating_session": "🔄 Création d'une nouvelle session...",
  "bot.create_session_error":
    "🔴 Impossible de créer la session. Essayez /new ou vérifiez l'état du serveur avec /status.",
  "bot.session_created": "✅ Session créée : {title}",
  "bot.session_busy":
    "⏳ L'agent exécute déjà une tâche. Attendez la fin ou utilisez /abort pour interrompre l'exécution en cours.",
  "bot.session_reset_project_mismatch":
    "⚠️ La session active ne correspond pas au projet sélectionné, elle a donc été réinitialisée. Utilisez /sessions pour en choisir une ou /new pour créer une nouvelle session.",
  "bot.prompt_send_error": "Impossible d'envoyer la requête à OpenCode.",
  "bot.session_error": "🔴 OpenCode a renvoyé une erreur : {message}",
  "bot.session_retry":
    "🔁 {message}\n\nLe fournisseur renvoie la même erreur à chaque nouvelle tentative. Utilisez /abort pour arrêter.",
  "bot.unknown_command":
    "⚠️ Commande inconnue : {command}. Utilisez /help pour voir les commandes disponibles.",
  "bot.photo_downloading": "⏳ Téléchargement de la photo...",
  "bot.photo_too_large": "⚠️ La photo est trop volumineuse (max {maxSizeMb}MB)",
  "bot.photo_model_no_image":
    "⚠️ Le modèle actuel ne prend pas en charge les images. Envoi du texte uniquement.",
  "bot.photo_download_error": "🔴 Impossible de télécharger la photo",
  "bot.photo_no_caption":
    "💡 Conseil : ajoutez une légende pour décrire ce que vous voulez faire avec cette photo.",
  "bot.file_downloading": "⏳ Téléchargement du fichier...",
  "bot.file_too_large": "⚠️ Le fichier est trop volumineux (max {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 Impossible de télécharger le fichier",
  "bot.model_no_pdf":
    "⚠️ Le modèle actuel ne prend pas en charge les PDF. Envoi du texte uniquement.",
  "bot.text_file_too_large": "⚠️ Le fichier texte est trop volumineux (max {maxSizeKb}KB)",

  "status.header_running": "🟢 Le serveur OpenCode est en cours d'exécution",
  "status.health.healthy": "Sain",
  "status.health.unhealthy": "Dégradé",
  "status.line.health": "Statut : {health}",
  "status.line.version": "Version : {version}",
  "status.line.managed_yes": "Démarré par le bot : Oui",
  "status.line.managed_no": "Démarré par le bot : Non",
  "status.line.pid": "PID : {pid}",
  "status.line.uptime_sec": "Temps de fonctionnement : {seconds} sec",
  "status.line.mode": "Mode : {mode}",
  "status.line.model": "Modèle : {model}",
  "status.agent_not_set": "non défini",
  "status.project_selected": "Projet : {project}",
  "status.project_not_selected": "Projet : non sélectionné",
  "status.project_hint": "Utilisez /projects pour sélectionner un projet",
  "status.session_selected": "Session actuelle : {title}",
  "status.session_not_selected": "Session actuelle : non sélectionnée",
  "status.session_hint": "Utilisez /sessions pour en sélectionner une ou /new pour en créer une",
  "status.server_unavailable":
    "🔴 Le serveur OpenCode est indisponible\n\nUtilisez /opencode_start pour démarrer le serveur.",

  "projects.empty":
    "📭 Aucun projet trouvé.\n\nOuvrez un répertoire dans OpenCode et créez au moins une session, il apparaîtra ensuite ici.",
  "projects.select": "Sélectionnez un projet :",
  "projects.select_with_current": "Sélectionnez un projet :\n\nActuel : 🏗 {project}",
  "projects.page_indicator": "Page {current}/{total}",
  "projects.prev_page": "⬅️ Précédent",
  "projects.next_page": "Suivant ➡️",
  "projects.fetch_error":
    "🔴 Le serveur OpenCode est indisponible ou une erreur s'est produite lors du chargement des projets.",
  "projects.page_load_error": "Impossible de charger cette page. Veuillez réessayer.",
  "projects.selected":
    "✅ Projet sélectionné : {project}\n\n📋 La session a été réinitialisée. Utilisez /sessions ou /new pour ce projet.",
  "projects.select_error": "🔴 Impossible de sélectionner le projet.",

  "sessions.project_not_selected":
    "🏗 Aucun projet n'est sélectionné.\n\nSélectionnez d'abord un projet avec /projects.",
  "sessions.empty": "📭 Aucune session trouvée.\n\nCréez une nouvelle session avec /new.",
  "sessions.select": "Sélectionnez une session :",
  "sessions.select_page": "Sélectionnez une session (page {page}) :",
  "sessions.fetch_error":
    "🔴 Le serveur OpenCode est indisponible ou une erreur s'est produite lors du chargement des sessions.",
  "sessions.select_project_first": "🔴 Aucun projet n'est sélectionné. Utilisez /projects.",
  "sessions.page_empty_callback": "Aucune session sur cette page",
  "sessions.page_load_error_callback": "Impossible de charger cette page. Veuillez réessayer.",
  "sessions.button.prev_page": "⬅️ Préc.",
  "sessions.button.next_page": "Suiv. ➡️",
  "sessions.loading_context": "⏳ Chargement du contexte et des derniers messages...",
  "sessions.selected": "✅ Session sélectionnée : {title}",
  "sessions.select_error": "🔴 Impossible de sélectionner la session.",
  "sessions.preview.empty": "Aucun message récent.",
  "sessions.preview.title": "Messages récents :",
  "sessions.preview.you": "Vous :",
  "sessions.preview.agent": "Agent :",

  "new.project_not_selected":
    "🏗 Aucun projet n'est sélectionné.\n\nSélectionnez d'abord un projet avec /projects.",
  "new.created": "✅ Nouvelle session créée : {title}",
  "new.create_error":
    "🔴 Le serveur OpenCode est indisponible ou une erreur s'est produite lors de la création de la session.",

  "stop.no_active_session":
    "🛑 L'agent n'a pas été démarré\n\nCréez une session avec /new ou sélectionnez-en une via /sessions.",
  "stop.in_progress":
    "🛑 Flux d'événements arrêté, envoi du signal d'abandon...\n\nEn attente de l'arrêt de l'agent.",
  "stop.warn_unconfirmed":
    "⚠️ Le flux d'événements a été arrêté, mais le serveur n'a pas confirmé l'abandon.\n\nVérifiez /status et réessayez /abort dans quelques secondes.",
  "stop.warn_maybe_finished":
    "⚠️ Le flux d'événements a été arrêté, mais l'agent a peut-être déjà terminé.",
  "stop.success":
    "✅ Action de l'agent interrompue. Aucun autre message de cette exécution ne sera envoyé.",
  "stop.warn_still_busy":
    "⚠️ Le signal a été envoyé, mais l'agent est toujours occupé.\n\nLe flux d'événements est déjà désactivé, donc aucun message intermédiaire ne sera envoyé.",
  "stop.warn_timeout":
    "⚠️ Délai dépassé pour la requête d'abandon.\n\nLe flux d'événements est déjà arrêté, réessayez /abort dans quelques secondes.",
  "stop.warn_local_only":
    "⚠️ Le flux d'événements a été arrêté localement, mais l'abandon côté serveur a échoué.",
  "stop.error":
    "🔴 Impossible d'arrêter l'action.\n\nLe flux d'événements est arrêté, essayez /abort à nouveau.",

  "opencode_start.already_running_managed":
    "⚠️ Le serveur OpenCode est déjà en cours d'exécution\n\nPID : {pid}\nTemps de fonctionnement : {seconds} secondes",
  "opencode_start.already_running_external":
    "✅ Le serveur OpenCode est déjà en cours d'exécution en tant que processus externe\n\nVersion : {version}\n\nCe serveur n'a pas été démarré par le bot, donc /opencode-stop ne peut pas l'arrêter.",
  "opencode_start.starting": "🔄 Démarrage du serveur OpenCode...",
  "opencode_start.start_error":
    "🔴 Impossible de démarrer le serveur OpenCode\n\nErreur : {error}\n\nVérifiez que l'interface en ligne de commande OpenCode est installée et disponible dans le PATH :\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ Le serveur OpenCode a démarré, mais ne répond pas encore\n\nPID : {pid}\n\nLe serveur est peut-être encore en cours de démarrage. Essayez /status dans quelques secondes.",
  "opencode_start.success":
    "✅ Serveur OpenCode démarré avec succès\n\nPID : {pid}\nVersion : {version}",
  "opencode_start.error":
    "🔴 Une erreur s'est produite lors du démarrage du serveur.\n\nConsultez les logs de l'application pour plus de détails.",
  "opencode_stop.external_running":
    "⚠️ Le serveur OpenCode s'exécute comme processus externe\n\nCe serveur n'a pas été démarré via /opencode-start.\nArrêtez-le manuellement ou utilisez /status pour vérifier son état.",
  "opencode_stop.not_running": "⚠️ Le serveur OpenCode n'est pas en cours d'exécution",
  "opencode_stop.stopping": "🛑 Arrêt du serveur OpenCode...\n\nPID : {pid}",
  "opencode_stop.stop_error": "🔴 Impossible d'arrêter le serveur OpenCode\n\nErreur : {error}",
  "opencode_stop.success": "✅ Serveur OpenCode arrêté avec succès",
  "opencode_stop.error":
    "🔴 Une erreur s'est produite lors de l'arrêt du serveur.\n\nConsultez les logs de l'application pour plus de détails.",

  "agent.changed_callback": "Mode modifié : {name}",
  "agent.changed_message": "✅ Mode défini sur : {name}",
  "agent.change_error_callback": "Impossible de modifier le mode",
  "agent.menu.current": "Mode actuel : {name}\n\nSélectionnez un mode :",
  "agent.menu.select": "Sélectionnez un mode de travail :",
  "agent.menu.empty": "⚠️ Aucun mode disponible",
  "agent.menu.error": "🔴 Impossible de récupérer la liste des modes",

  "model.changed_callback": "Modèle modifié : {name}",
  "model.changed_message": "✅ Modèle défini sur : {name}",
  "model.change_error_callback": "Impossible de modifier le modèle",
  "model.menu.empty": "⚠️ Aucun modèle disponible",
  "model.menu.select": "Sélectionnez un modèle :",
  "model.menu.current": "Modèle actuel : {name}\n\nSélectionnez un modèle :",
  "model.menu.favorites_title":
    "⭐ Favoris (ajoutez des modèles aux favoris dans l'interface OpenCode)",
  "model.menu.favorites_empty": "— Vide.",
  "model.menu.recent_title": "🕘 Récents",
  "model.menu.recent_empty": "— Vide.",
  "model.menu.favorites_hint":
    "ℹ️ Ajoutez des modèles aux favoris dans l'interface OpenCode pour les garder en tête de liste.",
  "model.menu.error": "🔴 Impossible de récupérer la liste des modèles",

  "variant.model_not_selected_callback": "Erreur : aucun modèle sélectionné",
  "variant.changed_callback": "Variante modifiée : {name}",
  "variant.changed_message": "✅ Variante définie sur : {name}",
  "variant.change_error_callback": "Impossible de modifier la variante",
  "variant.select_model_first": "⚠️ Sélectionnez d'abord un modèle",
  "variant.menu.empty": "⚠️ Aucune variante disponible",
  "variant.menu.current": "Variante actuelle : {name}\n\nSélectionnez une variante :",
  "variant.menu.error": "🔴 Impossible de récupérer la liste des variantes",

  "context.button.confirm": "✅ Oui, compacter le contexte",
  "context.no_active_session": "⚠️ Aucune session active. Créez une session avec /new",
  "context.confirm_text":
    "📊 Réduction du contexte pour la session \"{title}\"\n\nCela réduira l'utilisation du contexte en supprimant les anciens messages de l'historique. La tâche en cours ne sera pas interrompue.\n\nContinuer ?",
  "context.callback_session_not_found": "Session introuvable",
  "context.callback_compacting": "Réduction du contexte en cours...",
  "context.progress": "⏳ Réduction du contexte en cours...",
  "context.error": "❌ La réduction du contexte a échoué",
  "context.success": "✅ Contexte compacté avec succès",

  "permission.inactive_callback": "La demande d'autorisation est inactive",
  "permission.processing_error_callback": "Erreur de traitement",
  "permission.no_active_request_callback": "Erreur : aucune demande active",
  "permission.reply.once": "Autorisé une fois",
  "permission.reply.always": "Toujours autorisé",
  "permission.reply.reject": "Refusé",
  "permission.send_reply_error": "❌ Impossible d'envoyer la réponse d'autorisation",
  "permission.blocked.expected_reply":
    "⚠️ Veuillez d'abord répondre à la demande d'autorisation avec les boutons ci-dessus.",
  "permission.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible tant que vous n'avez pas répondu à la demande d'autorisation.",
  "permission.header": "{emoji} Demande d'autorisation : {name}\n\n",
  "permission.button.allow": "✅ Autoriser une fois",
  "permission.button.always": "🔓 Toujours autoriser",
  "permission.button.reject": "❌ Refuser",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Modifier",
  "permission.name.write": "Écrire",
  "permission.name.read": "Lire",
  "permission.name.webfetch": "Récupération web",
  "permission.name.websearch": "Recherche web",
  "permission.name.glob": "Recherche de fichiers",
  "permission.name.grep": "Recherche de contenu",
  "permission.name.list": "Lister le répertoire",
  "permission.name.task": "Tâche",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "Répertoire externe",

  "question.inactive_callback": "Le sondage est inactif",
  "question.processing_error_callback": "Erreur de traitement",
  "question.select_one_required_callback": "Sélectionnez au moins une option",
  "question.enter_custom_callback": "Envoyez votre réponse personnalisée sous forme de message",
  "question.cancelled": "❌ Sondage annulé",
  "question.answer_already_received": "Réponse déjà reçue, veuillez patienter...",
  "question.completed_no_answers": "✅ Sondage terminé (aucune réponse)",
  "question.no_active_project": "❌ Aucun projet actif",
  "question.no_active_request": "❌ Aucune demande active",
  "question.send_answers_error": "❌ Impossible d'envoyer les réponses à l'agent",
  "question.multi_hint": "\n(Vous pouvez sélectionner plusieurs options)",
  "question.button.submit": "✅ Terminer",
  "question.button.custom": "🔤 Réponse personnalisée",
  "question.button.cancel": "❌ Annuler",
  "question.use_custom_button_first":
    "⚠️ Pour envoyer du texte, appuyez d'abord sur « Réponse personnalisée » pour la question actuelle.",
  "question.summary.title": "✅ Sondage terminé !\n\n",
  "question.summary.question": "Question {index} :\n{question}\n\n",
  "question.summary.answer": "Réponse :\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} Mode {name}",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Par défaut",
  "keyboard.updated": "⌨️ Clavier mis à jour",

  "pinned.default_session_title": "nouvelle session",
  "pinned.unknown": "Inconnu",
  "pinned.line.project": "Projet : {project}",
  "pinned.line.model": "Modèle : {model}",
  "pinned.line.context": "Contexte : {used} / {limit} ({percent}%)",
  "pinned.files.title": "Fichiers ({count}) :",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... et encore {count}",

  "tool.todo.overflow": "*({count} tâches supplémentaires)*",
  "tool.file_header.write":
    "Écrire Fichier/Chemin : {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Modifier Fichier/Chemin : {path}\n============================================================\n\n",

  "runtime.wizard.ask_token":
    "Entrez le token du bot Telegram (obtenez-le auprès de @BotFather).\n> ",
  "runtime.wizard.ask_language":
    "Sélectionnez la langue de l'interface.\nEntrez le numéro de la langue dans la liste ou le code locale.\nAppuyez sur Entrée pour conserver la langue par défaut : {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Entrez un numéro de langue de la liste ou un code locale pris en charge.\n",
  "runtime.wizard.language_selected": "Langue sélectionnée : {language}\n",
  "runtime.wizard.token_required": "Le token est requis. Veuillez réessayer.\n",
  "runtime.wizard.token_invalid":
    "Le token semble invalide (format attendu <id>:<secret>). Veuillez réessayer.\n",
  "runtime.wizard.ask_user_id":
    "Entrez votre identifiant utilisateur Telegram (vous pouvez l'obtenir auprès de @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Entrez un entier positif (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Entrez l'URL de l'API OpenCode (optionnel).\nAppuyez sur Entrée pour utiliser la valeur par défaut : {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "Entrez le nom d'utilisateur du serveur OpenCode (optionnel).\nAppuyez sur Entrée pour utiliser la valeur par défaut : {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "Entrez le mot de passe du serveur OpenCode (optionnel).\nAppuyez sur Entrée pour le laisser vide.\n> ",
  "runtime.wizard.api_url_invalid":
    "Entrez une URL valide (http/https) ou appuyez sur Entrée pour la valeur par défaut.\n",
  "runtime.wizard.start": "Configuration d'OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Configuration enregistrée :\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "L'application n'est pas encore configurée. Lancement de l'assistant...\n",
  "runtime.wizard.tty_required":
    "L'assistant interactif nécessite un terminal TTY. Exécutez `opencode-telegram config` dans un shell interactif.",

  "rename.no_session": "⚠️ Aucune session active. Créez ou sélectionnez d'abord une session.",
  "rename.prompt": "📝 Entrez le nouveau titre de la session :\n\nActuel : {title}",
  "rename.empty_title": "⚠️ Le titre ne peut pas être vide.",
  "rename.success": "✅ Session renommée en : {title}",
  "rename.error": "🔴 Impossible de renommer la session.",
  "rename.cancelled": "❌ Renommage annulé.",
  "rename.inactive_callback": "La demande de renommage est inactive",
  "rename.inactive": "⚠️ La demande de renommage n'est pas active. Exécutez /rename à nouveau.",
  "rename.blocked.expected_name":
    "⚠️ Entrez le nouveau nom de la session sous forme de texte ou appuyez sur Annuler dans le message de renommage.",
  "rename.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible tant que le renommage attend un nouveau nom.",
  "rename.button.cancel": "❌ Annuler",

  "task.prompt.schedule":
    "⏰ Envoyez le planning de la tâche en langage naturel.\n\nExemples :\n- toutes les 5 minutes\n- chaque jour à 17:00\n- demain à 12:00",
  "task.schedule_empty": "⚠️ Le planning ne peut pas être vide.",
  "task.parse.in_progress": "⏳ Analyse du planning...",
  "task.parse_error":
    "🔴 Impossible d'interpréter le planning.\n\n{message}\n\nEnvoyez le créneau à nouveau de façon plus claire.",
  "task.schedule_preview":
    "✅ Planning interprété\n\nCompris comme : {summary}\nFuseau horaire : {timezone}\nType : {kind}\nProchaine exécution : {nextRunAt}",
  "task.prompt.body": "📝 Envoyez maintenant ce que le bot doit faire selon ce planning.",
  "task.prompt_empty": "⚠️ Le texte de la tâche ne peut pas être vide.",
  "task.created":
    "✅ Tâche planifiée créée\n\nTâche : {description}\nProjet : {project}\nModèle : {model}\nPlanning : {schedule}\nProchaine exécution : {nextRunAt}",
  "task.button.retry_schedule": "🔁 Ressaisir le planning",
  "task.button.cancel": "❌ Annuler",
  "task.retry_schedule_callback": "Retour à la saisie du planning...",
  "task.cancel_callback": "Annulation...",
  "task.cancelled": "❌ Création de la tâche planifiée annulée.",
  "task.inactive_callback": "Ce flux de tâche planifiée n'est plus actif",
  "task.inactive": "⚠️ La création de tâche planifiée n'est pas active. Relancez /task.",
  "task.blocked.expected_input":
    "⚠️ Terminez d'abord la configuration de la tâche planifiée : envoyez du texte ou utilisez le bouton dans le message du planning.",
  "task.blocked.command_not_allowed":
    "⚠️ Cette commande n'est pas disponible pendant la création d'une tâche planifiée.",
  "task.schedule_too_frequent":
    "Le planning récurrent est trop fréquent. L'intervalle minimum autorisé est d'une fois toutes les 5 minutes.",
  "task.kind.cron": "récurrente",
  "task.kind.once": "ponctuelle",
  "task.run.success": "⏰ Tâche planifiée terminée : {description}\n\n{result}",
  "task.run.error": "🔴 Échec de la tâche planifiée : {description}\n\nErreur : {error}",

  "commands.select": "Choisissez une commande OpenCode :",
  "commands.empty": "📭 Aucune commande OpenCode n'est disponible pour ce projet.",
  "commands.fetch_error": "🔴 Impossible de charger les commandes OpenCode.",
  "commands.no_description": "Aucune description",
  "commands.button.execute": "✅ Exécuter",
  "commands.button.cancel": "❌ Annuler",
  "commands.confirm":
    "Confirmez l'exécution de la commande {command}. Pour l'exécuter avec des arguments, envoyez-les dans un message.",
  "commands.inactive_callback": "Ce menu de commandes est inactif",
  "commands.cancelled_callback": "Annulé",
  "commands.execute_callback": "Exécution de la commande...",
  "commands.executing_prefix": "⚡ Exécution de la commande :",
  "commands.arguments_empty":
    "⚠️ Les arguments ne peuvent pas être vides. Envoyez du texte ou appuyez sur Exécuter.",
  "commands.execute_error": "🔴 Impossible d'exécuter la commande OpenCode.",

  "cmd.description.rename": "Renommer la session actuelle",

  "cli.usage":
    "Utilisation :\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nNotes :\n  - Sans commande, `start` est utilisé par défaut\n  - `--mode` n'est actuellement pris en charge que pour `start`",
  "cli.placeholder.status":
    "La commande `status` est actuellement un placeholder. Les vraies vérifications d'état seront ajoutées dans la couche service (Phase 5).",
  "cli.placeholder.stop":
    "La commande `stop` est actuellement un placeholder. Le véritable arrêt du processus en arrière-plan sera ajouté dans la couche service (Phase 5).",
  "cli.placeholder.unavailable": "Commande indisponible.",
  "cli.error.prefix": "Erreur CLI : {message}",
  "cli.args.unknown_command": "Commande inconnue : {value}",
  "cli.args.mode_requires_value": "L'option --mode nécessite une valeur : sources|installed",
  "cli.args.invalid_mode": "Valeur de mode invalide : {value}. Attendu : sources|installed",
  "cli.args.unknown_option": "Option inconnue : {value}",
  "cli.args.mode_only_start":
    "L'option --mode est prise en charge uniquement pour la commande start",

  "legacy.models.fetch_error":
    "🔴 Impossible de récupérer la liste des modèles. Vérifiez l'état du serveur avec /status.",
  "legacy.models.empty": "📋 Aucun modèle disponible. Configurez les fournisseurs dans OpenCode.",
  "legacy.models.header": "📋 Modèles disponibles :\n\n",
  "legacy.models.no_provider_models": "  ⚠️ Aucun modèle disponible\n",
  "legacy.models.env_hint": "💡 Pour utiliser le modèle dans .env :\n",
  "legacy.models.error": "🔴 Une erreur s'est produite lors du chargement de la liste des modèles.",

  "stt.recognizing": "🎤 Reconnaissance audio en cours...",
  "stt.recognized": "🎤 Reconnu :\n{text}",
  "stt.not_configured":
    "🎤 La reconnaissance vocale n'est pas configurée.\n\nDéfinissez STT_API_URL et STT_API_KEY dans .env pour l'activer.",
  "stt.error": "🔴 Impossible de reconnaître l'audio : {error}",
  "stt.empty_result": "🎤 Aucune parole détectée dans le message audio.",
};
