export const he = {
  "cmd.description.status": "מצב שרת וסשן",
  "cmd.description.new": "צור סשן חדש",
  "cmd.description.stop": "עצור פעולה נוכחית",
  "cmd.description.detach": "התנתק מהסשן הנוכחי",
  "cmd.description.sessions": "רשימת סשנים",
  "cmd.description.messages": "עיין בהודעות סשן",
  "cmd.description.tts": "החלף תגובות קוליות",
  "cmd.description.projects": "רשימת פרויקטים",
  "cmd.description.worktree": "החלף worktrees של git",
  "cmd.description.task": "צור משימה מתוזמנת",
  "cmd.description.tasklist": "רשימת משימות מתוזמנות",
  "cmd.description.commands": "פקודות מותאמות אישית",
  "cmd.description.skills": "קטלוג יכולות",
  "cmd.description.mcps": "שרתי MCP",
  "cmd.description.opencode_start": "הפעל שרת OpenCode",
  "cmd.description.opencode_stop": "עצור שרת OpenCode",
  "cmd.description.ls": "רשימת תוכן תיקייה",
  "cmd.description.help": "עזרה",

  "callback.unknown_command": "פקודה לא ידועה",
  "callback.processing_error": "שגיאה בעיבוד",

  "error.load_agents": "❌ טעינת רשימת הסוכנים נכשלה",
  "error.load_models": "❌ טעינת רשימת המודלים נכשלה",
  "error.load_variants": "❌ טעינת רשימת הווריאנטים נכשלה",
  "error.context_button": "❌ עיבוד כפתור הקונטקסט נכשל",
  "error.generic": "🔴 משהו השתבש.",

  "interaction.blocked.expired": "⚠️ אינטראקציה זו פגה. אנא התחל אותה מחדש.",
  "interaction.blocked.expected_callback":
    "⚠️ אנא השתמש בכפתורים המובנים לשלב זה או הקש ביטול.",
  "interaction.blocked.expected_text": "⚠️ אנא שלח הודעת טקסט לשלב זה.",
  "interaction.blocked.expected_command": "⚠️ אנא שלח פקודה לשלב זה.",
  "interaction.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה בשלב הנוכחי.",
  "interaction.blocked.finish_current":
    "⚠️ סיים תחילה את האינטראקציה הנוכחית (ענה או בטל), ואז פתח תפריט אחר.",

  "inline.blocked.expected_choice": "⚠️ בחר אפשרות באמצעות הכפתורים המובנים או הקש ביטול.",
  "inline.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה בזמן שתפריט מובנה פעיל.",

  "question.blocked.expected_answer":
    "⚠️ ענה על השאלה הנוכחית באמצעות כפתורים, תשובה מותאמת אישית או ביטול.",
  "question.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה עד להשלמת זרימת השאלה הנוכחית.",

  "inline.button.cancel": "❌ ביטול",
  "inline.inactive_callback": "תפריט זה אינו פעיל",
  "inline.cancelled_callback": "בוטל",

  "common.unknown": "לא ידוע",
  "common.unknown_error": "שגיאה לא ידועה",

  "start.welcome":
    "👋 ברוכים הבאים ל-OpenCode Telegram Bot!\n\nפקודות:\n/projects — בחר פרויקט\n/sessions — רשימת סשנים\n/new — סשן חדש\n/commands — פקודות מותאמות אישית\n/skills — קטלוג יכולות\n/task — משימה מתוזמנת\n/tasklist — משימות מתוזמנות\n/status — מצב\n/help — עזרה\n\nהשתמש בכפתורים התחתונים לבחירת הסוכן, המודל והווריאנט.",
  "help.keyboard_hint":
    "💡 השתמש בכפתורי המקלדת התחתונים לפעולות סוכן, מודל, וריאנט וקונטקסט.",
  "help.text":
    "📖 **עזרה**\n\n/status - בדוק מצב שרת\n/sessions - רשימת סשנים\n/new - צור סשן חדש\n/help - עזרה",

  "bot.thinking": "💭 חושב...",
  "bot.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "bot.creating_session": "🔄 יוצר סשן חדש...",
  "bot.create_session_error":
    "🔴 יצירת הסשן נכשלה. נסה /new או בדוק מצב שרת עם /status.",
  "bot.session_created": "✅ סשן נוצר: {title}",
  "bot.session_busy":
    "⏳ הסוכן כבר מריץ משימה. המתן לסיום או השתמש ב-/abort להפסקת הריצה הנוכחית.",
  "bot.session_reset_project_mismatch":
    "⚠️ הסשן הפעיל אינו תואם לפרויקט הנבחר, ולכן אופס. השתמש ב-/sessions כדי לבחור אחד או ב-/new ליצירת סשן חדש.",
  "bot.prompt_send_error": "שליחת הבקשה ל-OpenCode נכשלה.",
  "bot.session_error": "🔴 OpenCode החזיר שגיאה: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nהספק מחזיר את אותה השגיאה בניסיונות חוזרים. השתמש ב-/abort כדי להפסיק.",
  "bot.external_user_input": "קלט משתמש חיצוני",
  "background.session_fallback": "סשן {id}",
  "background.assistant_response": "🔔 הסוכן השיב בסשן רקע: {session}",
  "background.question_asked": "❓ סשן רקע דורש תשובה: {session}",
  "background.permission_asked": "🔐 סשן רקע ביקש הרשאות: {session}",
  "background.open_session_button": "פתח סשן",
  "bot.unknown_command": "⚠️ פקודה לא ידועה: {command}. השתמש ב-/help לפקודות זמינות.",
  "bot.photo_downloading": "⏳ מוריד תמונה...",
  "bot.photo_too_large": "⚠️ התמונה גדולה מדי (מקסימום {maxSizeMb}MB)",
  "bot.photo_model_no_image": "⚠️ המודל הנוכחי לא תומך בקלט תמונה. שולח טקסט בלבד.",
  "bot.photo_download_error": "🔴 הורדת התמונה נכשלה",
  "bot.photo_no_caption": "💡 טיפ: הוסף כיתוב כדי לתאר מה ברצונך לעשות עם תמונה זו.",
  "bot.file_downloading": "⏳ מוריד קובץ...",
  "bot.files_downloading": "⏳ מוריד קבצים...",
  "bot.file_too_large": "⚠️ הקובץ גדול מדי (מקסימום {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 הורדת הקובץ נכשלה",
  "bot.file_type_unsupported":
    "⚠️ סוג קובץ זה אינו נתמך. שלח תמונה, PDF או קובץ טקסט/קוד.",
  "bot.media_group_not_processed":
    "⚠️ קובץ אחד או יותר באלבום זה לא ניתן לעיבוד. דבר לא נשלח ל-OpenCode.",
  "bot.media_group_download_error":
    "🔴 הורדת אחד הקבצים נכשלה. דבר לא נשלח ל-OpenCode.",
  "bot.model_no_pdf": "⚠️ המודל הנוכחי לא תומך בקלט PDF. שולח טקסט בלבד.",
  "bot.text_file_too_large": "⚠️ קובץ הטקסט גדול מדי (מקסימום {maxSizeKb}KB)",

  "status.header_running": "🟢 שרת OpenCode פועל",
  "status.health.healthy": "תקין",
  "status.health.unhealthy": "לא תקין",
  "status.line.health": "מצב: {health}",
  "status.line.version": "גרסה: {version}",
  "status.line.managed_yes": "הופעל על ידי הבוט: כן",
  "status.line.managed_no": "הופעל על ידי הבוט: לא",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "זמן פעילות: {seconds} שנ'",
  "status.line.mode": "סוכן: {mode}",
  "status.line.model": "מודל: {model}",
  "status.line.tts": "תגובות קוליות: {tts}",
  "status.tts.on": "פועל",
  "status.tts.off": "כבוי",
  "status.agent_not_set": "לא הוגדר",
  "status.project_selected": "פרויקט: {project}",
  "status.worktree_selected": "Worktree: {worktree}",
  "status.project_not_selected": "פרויקט: לא נבחר",
  "status.project_hint": "השתמש ב-/projects לבחירת פרויקט",
  "status.session_selected": "סשן נוכחי: {title}",
  "status.session_not_selected": "סשן נוכחי: לא נבחר",
  "status.session_hint": "השתמש ב-/sessions לבחירה או ב-/new ליצירה",
  "status.server_unavailable":
    "🔴 שרת OpenCode לא זמין\n\nהשתמש ב-/opencode_start כדי להפעיל את השרת.",

  "tts.enabled": "🔊 תגובות קוליות הופעלו גלובלית.",
  "tts.not_configured":
    "⚠️ תגובות קוליות אינן זמינות. הגדר `TTS_API_URL` ו-`TTS_API_KEY` תחילה.",
  "tts.disabled": "🔇 תגובות קוליות כובו גלובלית.",
  "tts.failed": "⚠️ יצירת תגובה קולית נכשלה.",

  "projects.empty":
    "📭 לא נמצאו פרויקטים.\n\nפתח תיקייה ב-OpenCode וצור לפחות סשן אחד, ואז הוא יופיע כאן.",
  "projects.select": "בחר פרויקט:",
  "projects.select_with_current": "בחר פרויקט:\n\nנוכחי: 🏗 {project}",
  "projects.page_indicator": "עמוד {current}/{total}",
  "projects.prev_page": "⬅️ הקודם",
  "projects.next_page": "הבא ➡️",
  "projects.fetch_error":
    "🔴 שרת OpenCode לא זמין או שאירעה שגיאה בטעינת פרויקטים.",
  "projects.page_load_error": "לא ניתן לטעון עמוד זה. אנא נסה שוב.",
  "projects.selected":
    "✅ פרויקט נבחר: {project}\n\n📋 הסשן אופס. השתמש ב-/sessions או /new עבור פרויקט זה.",
  "projects.select_error": "🔴 בחירת הפרויקט נכשלה.",

  "sessions.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "sessions.empty": "📭 לא נמצאו סשנים.\n\nצור סשן חדש עם /new.",
  "sessions.select": "בחר סשן:",
  "sessions.select_page": "בחר סשן (עמוד {page}):",
  "sessions.fetch_error":
    "🔴 שרת OpenCode לא זמין או שאירעה שגיאה בטעינת סשנים.",
  "sessions.select_project_first": "🔴 פרויקט לא נבחר. השתמש ב-/projects.",
  "sessions.page_empty_callback": "אין סשנים בעמוד זה",
  "sessions.page_load_error_callback": "לא ניתן לטעון עמוד זה. אנא נסה שוב.",
  "sessions.button.prev_page": "⬅️ הקודם",
  "sessions.button.next_page": "הבא ➡️",
  "sessions.loading_context": "⏳ טוען קונטקסט והודעות אחרונות...",
  "sessions.selected": "✅ סשן נבחר: {title}",
  "sessions.select_error": "🔴 בחירת הסשן נכשלה.",
  "sessions.preview.empty": "אין הודעות אחרונות.",
  "sessions.preview.title": "הודעות אחרונות:",
  "sessions.preview.you": "אתה:",
  "sessions.preview.agent": "סוכן:",

  "messages.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "messages.session_not_selected":
    "💬 סשן לא נבחר.\n\nראשית בחר סשן עם /sessions או צור אחד עם /new.",
  "messages.session_project_mismatch":
    "⚠️ הסשן שנבחר אינו תואם לפרויקט הנוכחי. בחר את הסשן שוב דרך /sessions.",
  "messages.empty": "📭 אין הודעות משתמש בסשן הנוכחי.",
  "messages.select": "בחר הודעה:",
  "messages.select_page": "בחר הודעה (עמוד {page}):",
  "messages.fetch_error":
    "🔴 שרת OpenCode לא זמין או שאירעה שגיאה בטעינת הודעות.",
  "messages.inactive_callback": "תפריט הודעות זה אינו פעיל",
  "messages.cancelled_callback": "בוטל",
  "messages.page_empty_callback": "אין הודעות בעמוד זה",
  "messages.button.prev_page": "⬅️ הקודם",
  "messages.button.next_page": "הבא ➡️",
  "messages.button.revert": "↩️ שחזר",
  "messages.button.fork": "🔀 פצל",
  "messages.button.back": "⬅️ חזור",
  "messages.button.cancel": "❌ ביטול",
  "messages.revert_success": "✅ שוחזר להודעה:\n\n{text}",
  "messages.revert_error": "❌ שחזור ההודעה נכשל. אנא נסה שוב.",
  "messages.fork_success": "🔀 פיצול נוצר מהודעה:\n\n{text}",
  "messages.fork_error": "❌ יצירת הפיצול נכשלה. אנא נסה שוב.",

  "attach.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "attach.session_not_selected":
    "💬 סשן לא נבחר.\n\nראשית בחר סשן עם /sessions.",
  "attach.session_project_mismatch":
    "⚠️ הסשן שנבחר אינו תואם לפרויקט הנוכחי. בחר את הסשן שוב דרך /sessions.",
  "attach.connected": "✅ מחובר לסשן: {title}",
  "attach.already_connected": "ℹ️ כבר מחובר לסשן: {title}",
  "attach.status.idle_message": "מצב: המתנה. ממתין לאירועים חדשים.",
  "attach.status.busy_message": "מצב: עסוק. פרומפטים חדשים חסומים זמנית.",
  "attach.restored_question": "שוחזרה שאלה ממתינה עבור סשן זה.",
  "attach.restored_permissions": "שוחזרו בקשות הרשאה ממתינות: {count}.",
  "attach.disconnect_hint": "לניתוק, עבור לסשן או פרויקט אחר.",
  "attach.error": "🔴 ההתקשרות לסשן הנוכחי נכשלה.",

  "detach.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "detach.no_active_session": "ℹ️ הבוט כבר מנותק מכל סשן.",
  "detach.success":
    "✅ מנותק מסשן: {title}\n\nסשן OpenCode לא הופסק. אם הוא עדיין פועל, הוא ימשך בנפרד. כדי לבדוק אותו מאוחר יותר, בחר אותו שוב דרך /sessions.",
  "detach.error": "🔴 ההתנתקות מהסשן הנוכחי נכשלה.",

  "new.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "new.created": "✅ סשן חדש נוצר: {title}",
  "new.create_error":
    "🔴 שרת OpenCode לא זמין או שאירעה שגיאה ביצירת הסשן.",

  "stop.no_active_session":
    "🛑 הסוכן לא הופעל\n\nצור סשן עם /new או בחר אחד דרך /sessions.",
  "stop.in_progress":
    "🛑 זרם האירועים הופסק, שולח אות עצירה...\n\nממתין לעצירת הסוכן.",
  "stop.warn_unconfirmed":
    "⚠️ זרם האירועים הופסק, אך השרת לא אישר את העצירה.\n\nבדוק /status ונסה /abort שוב בעוד מספר שניות.",
  "stop.warn_maybe_finished": "⚠️ זרם האירועים הופסק, אך ייתכן שהסוכן כבר סיים.",
  "stop.success": "✅ פעולת הסוכן הופסקה. לא ישלחו הודעות נוספות מריצה זו.",
  "stop.warn_still_busy":
    "⚠️ האות נשלח, אך הסוכן עדיין עסוק.\n\nזרם האירועים כבר מושבת, כך שלא ישלחו הודעות ביניים.",
  "stop.warn_timeout":
    "⚠️ פסק זמן לבקשת העצירה.\n\nזרם האירועים כבר מושבת, נסה /abort שוב בעוד מספר שניות.",
  "stop.warn_local_only": "⚠️ זרם האירועים הופסק מקומית, אך עצירת השרת בצד השרת נכשלה.",
  "stop.error": "🔴 עצירת הפעולה נכשלה.\n\nזרם האירועים הופסק, נסה /abort שוב.",

  "opencode_start.already_running_managed":
    "⚠️ שרת OpenCode כבר פועל\n\nPID: {pid}\nזמן פעילות: {seconds} שניות",
  "opencode_start.already_running_external":
    "✅ שרת OpenCode כבר פועל כתהליך חיצוני\n\nגרסה: {version}\n\nשרת זה לא הופעל על ידי הבוט, לכן /opencode-stop לא יכול לעצור אותו.",
  "opencode_start.already_running": "✅ שרת OpenCode כבר פועל\n\nגרסה: {version}",
  "opencode_start.remote_configured": "⚠️ /opencode_start עובד רק עם שרת OpenCode מקומי.",
  "opencode_start.starting": "🔄 מפעיל שרת OpenCode...",
  "opencode_start.start_error":
    "🔴 הפעלת שרת OpenCode נכשלה\n\nשגיאה: {error}\n\nבדוק ש-OpenCode CLI מותאם וזמין ב-PATH:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ שרת OpenCode הופעל, אך אינו מגיב\n\nPID: {pid}\n\nהשרת עדיין可能在 לאתחל. נסה /status בעוד מספר שניות.",
  "opencode_start.success":
    "✅ שרת OpenCode הופעל בהצלחה\n\nPID: {pid}\nגרסה: {version}",
  "opencode_start.error":
    "🔴 אירעה שגיאה בהפעלת השרת.\n\nבדוק בלוגי האפליקציה לפרטים.",
  "opencode_stop.external_running":
    "⚠️ שרת OpenCode פועל כתהליך חיצוני\n\nשרת זה לא הופעל דרך /opencode-start.\nעצור אותו ידנית או השתמש ב-/status לבדיקת מצב.",
  "opencode_stop.remote_configured": "⚠️ /opencode_stop עובד רק עם שרת OpenCode מקומי.",
  "opencode_stop.not_running": "⚠️ שרת OpenCode אינו פועל",
  "opencode_stop.pid_not_found":
    "⚠️ שרת OpenCode מגיב בפורט {port}, אך לא נמצא תהליך מקומי לעצירה.",
  "opencode_stop.stopping": "🛑 עוצר שרת OpenCode...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 עצירת שרת OpenCode נכשלה\n\nשגיאה: {error}",
  "opencode_stop.still_running": "השרת עדיין מגיב לאחר בקשת העצירה.",
  "opencode_stop.success": "✅ שרת OpenCode נעצר בהצלחה",
  "opencode_stop.error":
    "🔴 אירעה שגיאה בעצירת השרת.\n\nבדוק בלוגי האפליקציה לפרטים.",

  "agent.changed_callback": "הסוכן שונה: {name}",
  "agent.changed_message": "✅ הסוכן שונה ל: {name}",
  "agent.change_error_callback": "שינוי הסוכן נכשל",
  "agent.menu.current": "סוכן נוכחי: {name}\n\nבחר סוכן:",
  "agent.menu.select": "בחר סוכן:",
  "agent.menu.empty": "⚠️ אין סוכנים זמינים",
  "agent.menu.error": "🔴 קבלת רשימת הסוכנים נכשלה",

  "model.changed_callback": "המודל שונה: {name}",
  "model.changed_message": "✅ המודל שונה ל: {name}",
  "model.change_error_callback": "שינוי המודל נכשל",
  "model.menu.empty": "⚠️ אין מודלים זמינים",
  "model.menu.select": "בחר מודל:",
  "model.menu.current": "מודל נוכחי: {name}\n\nבחר מודל:",
  "model.menu.favorites_title": "⭐ מועדפים (הוסף מודלים למועדפים ב-OpenCode CLI)",
  "model.menu.favorites_empty": "— ריק.",
  "model.menu.recent_title": "🕘 אחרונים",
  "model.menu.recent_empty": "— ריק.",
  "model.menu.favorites_hint":
    "ℹ️ הוסף מודלים למועדפים ב-OpenCode CLI כדי לשמור אותם בראש.",
  "model.menu.error": "🔴 קבלת רשימת המודלים נכשלה",
  "model.search.button": "🔍 חיפוש",
  "model.search.prompt": "🔍 הזן שם מודל לחיפוש:",
  "model.search.results_title": "תוצאות חיפוש עבור \"{query}\":",
  "model.search.no_results": "לא נמצאו מודלים עבור \"{query}\"",
  "model.search.search_again": "↩ חיפוש שוב",
  "model.search.error": "החיפוש נכשל",

  "variant.model_not_selected_callback": "שגיאה: המודל לא נבחר",
  "variant.changed_callback": "הווריאנט שונה: {name}",
  "variant.changed_message": "✅ הווריאנט שונה ל: {name}",
  "variant.change_error_callback": "שינוי הווריאנט נכשל",
  "variant.select_model_first": "⚠️ בחר מודל תחילה",
  "variant.menu.empty": "⚠️ אין וריאנטים זמינים",
  "variant.menu.current": "וריאנט נוכחי: {name}\n\nבחר וריאנט:",
  "variant.menu.error": "🔴 קבלת רשימת הווריאנטים נכשלה",

  "context.button.confirm": "✅ כן, דחוס קונטקסט",
  "context.no_active_session": "⚠️ אין סשן פעיל. צור סשן עם /new",
  "context.confirm_text":
    '📊 דחיסת קונטקסט עבור סשן "{title}"\n\nזה יפחית את השימוש בקונטקסט על ידי הסרת הודעות ישנות מההיסטוריה. המשימה הנוכחית לא תופסק.\n\nלהמשיך?',
  "context.callback_session_not_found": "הסשן לא נמצא",
  "context.callback_compacting": "דוחס קונטקסט...",
  "context.progress": "⏳ דוחס קונטקסט...",
  "context.error": "❌ דחיסת הקונטקסט נכשלה",
  "context.success": "✅ הקונטקסט נדחס בהצלחה",

  "permission.inactive_callback": "בקשת ההרשאה אינה פעילה",
  "permission.processing_error_callback": "שגיאה בעיבוד",
  "permission.no_active_request_callback": "שגיאה: אין בקשה פעילה",
  "permission.reply.once": "אושר פעם אחת",
  "permission.reply.always": "מורשה תמיד",
  "permission.reply.reject": "נדחה",
  "permission.send_reply_error": "❌ שליחת תשובת ההרשאה נכשלה",
  "permission.blocked.expected_reply":
    "⚠️ אנא ענה לבקשת ההרשאה תחילה באמצעות הכפתורים למעלה.",
  "permission.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה עד שתענה לבקשת ההרשאה.",
  "permission.header": "{emoji} בקשת הרשאה: {name}\n\n",
  "permission.button.allow": "✅ אשר פעם אחת",
  "permission.button.always": "🔓 אשר תמיד",
  "permission.button.reject": "❌ דחה",
  "permission.name.bash": "Bash",
  "permission.name.edit": "עריכה",
  "permission.name.write": "כתיבה",
  "permission.name.read": "קריאה",
  "permission.name.webfetch": "Web Fetch",
  "permission.name.websearch": "Web Search",
  "permission.name.glob": "File Search",
  "permission.name.grep": "Content Search",
  "permission.name.list": "List Directory",
  "permission.name.task": "משימה",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "תיקייה חיצונית",

  "question.inactive_callback": "הסקר אינו פעיל",
  "question.processing_error_callback": "שגיאה בעיבוד",
  "question.select_one_required_callback": "בחר לפחות אפשרות אחת",
  "question.enter_custom_callback": "שלח את התשובה המותאמת אישית כהודעה",
  "question.cancelled": "❌ הסקר בוטל",
  "question.answer_already_received": "התשובה כבר התקבלה, אנא המתן...",
  "question.completed_no_answers": "✅ הסקר הושלם (ללא תשובות)",
  "question.no_active_project": "❌ אין פרויקט פעיל",
  "question.no_active_request": "❌ אין בקשה פעילה",
  "question.send_answers_error": "❌ שליחת התשובות לסוכן נכשלה",
  "question.multi_hint": "\n(ניתן לבחור מספר אפשרויות)",
  "question.button.submit": "✅ סיום",
  "question.button.custom": "🔤 תשובה מותאמת אישית",
  "question.button.cancel": "❌ ביטול",
  "question.use_custom_button_first":
    '⚠️ לשליחת טקסט, הקש תחילה על "תשובה מותאמת אישית" לשאלה הנוכחית.',
  "question.summary.title": "✅ הסקר הושלם!\n\n",
  "question.summary.question": "שאלה {index}:\n{question}\n\n",
  "question.summary.answer": "תשובה:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} סוכן",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 ברירת מחדל",
  "keyboard.updated": "⌨️ המקלדת עודכנה",

  "pinned.default_session_title": "סשן חדש",
  "pinned.unknown": "לא ידוע",
  "pinned.line.project": "פרויקט: {project}",
  "pinned.line.worktree": "Worktree: {worktree}",
  "pinned.line.model": "מודל: {model}",
  "pinned.line.attach": "מעקב: {status}",
  "pinned.attach.status.idle": "פעיל, בהמתנה",
  "pinned.attach.status.busy": "פעיל, עסוק",
  "pinned.line.context": "קונטקסט: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "עלות: {cost} הוצא",
  "subagent.header": "תת-סוכן {agent}: {description}",
  "subagent.line.status": "מצב: {status}",
  "subagent.line.task": "משימה: {task}",
  "subagent.line.agent": "סוכן: {agent}",
  "subagent.working": "עובד...",
  "subagent.working_with_details": "עובד: {details}",
  "subagent.completed": "הושלם",
  "subagent.failed": "המשימה נכשלה",
  "subagent.status.pending": "ממתין",
  "subagent.status.running": "רץ",
  "subagent.status.completed": "הושלם",
  "subagent.status.error": "שגיאה",
  "pinned.files.title": "קבצים ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... ועוד {count}",

  "tool.todo.overflow": "*({count} משימות נוספות)*",
  "tool.file_header.write":
    "כתיבת קובץ/נתיב: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "עריכת קובץ/נתיב: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "הזן טוקן בוט של Telegram (קבל מ-@BotFather).\n> ",
  "runtime.wizard.ask_language":
    "בחר שפת ממשק.\nהזן את מספר השפה מהרשימה או קוד שפה.\nהקש Enter לשמירת ברירת המחדל: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "הזן מספר שפה מהרשימה או קוד שפה נתמך.\n",
  "runtime.wizard.language_selected": "שפה נבחרה: {language}\n",
  "runtime.wizard.token_required": "טוקן נדרש. אנא נסה שוב.\n",
  "runtime.wizard.token_invalid":
    "הטוקן נראה לא תקין (פורמט מצופה <id>:<secret>). אנא נסה שוב.\n",
  "runtime.wizard.ask_user_id":
    "הזן את מזהה המשתמש שלך ב-Telegram (קבל מ-@userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "הזן מספר שלם חיובי (> 0).\n",
  "runtime.wizard.ask_api_url":
    "הזן כתובת URL של API OpenCode (אופציונלי).\nהקש Enter לשימוש בברירת המחדל: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "הזן שם משתמש לשרת OpenCode (אופציונלי).\nהקש Enter לשימוש בברירת המחדל: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "הזן סיסמה לשרת OpenCode (אופציונלי).\nהקש Enter לשמירה על ריק.\n> ",
  "runtime.wizard.api_url_invalid": "הזן URL תקין (http/https) או הקש Enter לברירת מחדל.\n",
  "runtime.wizard.start": "הגדרת OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "התצורה נשמרה:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "האפליקציה עדיין לא הוגדרה. מפעיל אשף...\n",
  "runtime.wizard.tty_required":
    "האשף האינטראקטיבי דורש terminal TTY. הרץ `opencode-telegram config` ב-shell אינטראקטיבי.",

  "rename.no_session": "⚠️ אין סשן פעיל. צור או בחר סשן תחילה.",
  "rename.prompt": "📝 הזן כותרת חדשה לסשן:\n\nנוכחי: {title}",
  "rename.empty_title": "⚠️ הכותרת לא יכולה להיות ריקה.",
  "rename.success": "✅ הסשן שונה שם ל: {title}",
  "rename.error": "🔴 שינוי שם הסשן נכשל.",
  "rename.cancelled": "❌ שינוי השם בוטל.",
  "rename.inactive_callback": "בקשת שינוי השם אינה פעילה",
  "rename.inactive": "⚠️ בקשת שינוי השם אינה פעילה. הרץ /rename שוב.",
  "rename.blocked.expected_name":
    "⚠️ הזן שם סשן חדש כטקסט או הקש ביטול בהודעת שינוי השם.",
  "rename.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה בזמן שינוי השם ממתין לשם חדש.",
  "rename.button.cancel": "❌ ביטול",

  "task.prompt.schedule":
    "⏰ שלח את לוח הזמנים של המשימה בשפה טבעית.\n\nדוגמאות:\n- כל 5 דקות\n- כל יום ב-17:00\n- מחר ב-12:00",
  "task.schedule_empty": "⚠️ לוח הזמנים לא יכול להיות ריק.",
  "task.parse.in_progress": "⏳ מנתח לוח זמנים...",
  "task.parse_error":
    "🔴 ניתוח לוח הזמנים נכשל.\n\n{message}\n\nשלח את לוח הזמנים שוב בצורה ברורה יותר.",
  "task.schedule_preview":
    "✅ לוח הזמנים נותח\n\nאיך הבנתי אותו: {summary}\n{cronLine}אזור זמן: {timezone}\nסוג: {kind}\nריצה הבאה: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 כעת שלח מה הבוט צריך לעשות בלוח הזמנים.",
  "task.prompt_empty": "⚠️ טקסט המשימה לא יכול להיות ריק.",
  "task.created":
    "✅ משימה מתוזמנת נוצרה\n\nמשימה: {description}\nפרויקט: {project}\nמודל: {model}\nלוח זמנים: {schedule}\n{cronLine}ריצה הבאה: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 הזן שוב לוח זמנים",
  "task.button.cancel": "❌ ביטול",
  "task.retry_schedule_callback": "מזין שוב לוח זמנים...",
  "task.cancel_callback": "מבטל...",
  "task.cancelled": "❌ יצירת המשימה המתוזמנת בוטלה.",
  "task.inactive_callback": "זרימת משימה מתוזמנת זו אינה פעילה",
  "task.inactive": "⚠️ יצירת משימה מתוזמנת אינה פעילה. הרץ /task שוב.",
  "task.blocked.expected_input":
    "⚠️ סיים תחילה את הגדרת המשימה המתוזמנת הנוכחית על ידי שליחת טקסט או שימוש בכפתור בהודעת לוח הזמנים.",
  "task.blocked.command_not_allowed":
    "⚠️ פקודה זו אינה זמינה בזמן שיצירת משימה מתוזמנת פעילה.",
  "task.limit_reached": "⚠️ הגעת למגבלת המשימות ({limit}). מחק משימה מתוזמנת קיימת תחילה.",
  "task.schedule_too_frequent":
    "לוח הזמנים החוזר תכוף מדי. המרווח המינימלי המותר הוא פעם ב-5 דקות.",
  "task.kind.cron": "חוזר",
  "task.kind.once": "חד-פעמי",
  "task.run.success": "⏰ משימה מתוזמנת הושלמה: {description}",
  "task.run.error": "🔴 משימה מתוזמנת נכשלה: {description}\n\nשגיאה: {error}",
  "task.run.error.interactive_question":
    "המשימה המתוזמנת ביקשה שאלה אינטראקטיבית ואינה יכולה להמשיך ללא נוכחות.",
  "task.run.error.interactive_permission":
    "המשימה המתוזמנת ביקשה הרשאה אינטראקטיבית ואינה יכולה להמשיך ללא נוכחות.",

  "tasklist.empty": "📭 אין עדיין משימות מתוזמנות.",
  "tasklist.select": "בחר משימה מתוזמנת:",
  "tasklist.details":
    "⏰ משימה מתוזמנת\n\nמשימה: {prompt}\nפרויקט: {project}\nלוח זמנים: {schedule}\n{cronLine}אזור זמן: {timezone}\nריצה הבאה: {nextRunAt}\nריצה אחרונה: {lastRunAt}\nמספר ריצות: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 מחק",
  "tasklist.button.cancel": "❌ ביטול",
  "tasklist.deleted_callback": "נמחק",
  "tasklist.cancelled_callback": "בוטל",
  "tasklist.inactive_callback": "תפריט משימה מתוזמנת זו אינו פעיל",
  "tasklist.load_error": "🔴 טעינת המשימות המתוזמנות נכשלה.",

  "commands.select": "בחר פקודת OpenCode:",
  "commands.empty": "📭 אין פקודות OpenCode זמינות עבור פרויקט זה.",
  "commands.fetch_error": "🔴 טעינת פקודות OpenCode נכשלה.",
  "commands.no_description": "אין תיאור",
  "commands.button.execute": "✅ הרץ",
  "commands.button.cancel": "❌ ביטול",
  "commands.confirm":
    "אשר ביצוע פקודה {command}. כדי להריץ עם ארגומנטים, שלח את הארגומנטים כהודעה.",
  "commands.inactive_callback": "תפריט פקודות זה אינו פעיל",
  "commands.cancelled_callback": "בוטל",
  "commands.execute_callback": "מריץ פקודה...",
  "commands.executing_prefix": "⚡ מריץ פקודה:",
  "commands.arguments_empty": "⚠️ ארגומנטים לא יכולים להיות ריקים. שלח טקסט או הקש Execute.",
  "commands.execute_error": "🔴 ביצוע פקודת OpenCode נכשל.",
  "commands.select_page": "בחר פקודת OpenCode (עמוד {page}):",
  "commands.button.prev_page": "⬅️ הקודם",
  "commands.button.next_page": "הבא ➡️",
  "commands.page_empty_callback": "אין פקודות בעמוד זה",
  "commands.page_load_error_callback": "לא ניתן לטעון עמוד זה. אנא נסה שוב.",
  "commands.download.no_roots": "לא הוגדרו נתיבי עיון מותרים.",
  "commands.download.downloading": "מוריד קובץ...",
  "commands.download.not_found": "הקובץ לא נמצא",
  "commands.download.not_file": "הנתיב אינו קובץ",
  "commands.download.file_too_large": "הקובץ גדול מדי",
  "commands.download.size": "גודל",
  "commands.download.modified": "שונה לאחרונה",
  "commands.download.error": "הורדת הקובץ נכשלה.",

  "skills.select": "בחר יכולת OpenCode:",
  "skills.empty": "📭 אין יכולות OpenCode זמינות עבור פרויקט זה.",
  "skills.fetch_error": "🔴 טעינת יכולות OpenCode נכשלה.",
  "skills.no_description": "אין תיאור",
  "skills.button.execute": "✅ הרץ",
  "skills.button.cancel": "❌ ביטול",
  "skills.confirm":
    "אשר ביצוע יכולת {skill}. כדי להריץ עם ארגומנטים, שלח את הארגומנטים כהודעה.",
  "skills.inactive_callback": "תפריט יכולות זה אינו פעיל",
  "skills.cancelled_callback": "בוטל",
  "skills.execute_callback": "משתמש ביכולת...",
  "skills.executing_prefix": "⚡ משתמש ביכולת:",
  "skills.arguments_empty": "⚠️ ארגומנטים לא יכולים להיות ריקים. שלח טקסט או הקש Execute.",
  "skills.select_page": "בחר יכולת OpenCode (עמוד {page}):",
  "skills.button.prev_page": "⬅️ הקודם",
  "skills.button.next_page": "הבא ➡️",
  "skills.page_empty_callback": "אין יכולות בעמוד זה",
  "skills.page_load_error_callback": "לא ניתן לטעון עמוד זה. אנא נסה שוב.",

  "mcps.select": "שרתי MCP:",
  "mcps.empty": "📭 לא הוגדרו שרתי MCP.",
  "mcps.fetch_error": "🔴 טעינת שרתי MCP נכשלה.",
  "mcps.toggle_error": "🔴 שינוי מצב שרת MCP נכשל.",
  "mcps.enabling": "מפעיל...",
  "mcps.disabling": "משבית...",
  "mcps.status.connected": "🟢 מחובר",
  "mcps.status.disabled": "🔴 מושבת",
  "mcps.status.failed": "⚠️ נכשל",
  "mcps.status.needs_auth": "🔒 דורש אימות",
  "mcps.status.needs_client_registration": "🔒 דורש רישום",
  "mcps.detail.title": "שרת: {name}",
  "mcps.detail.status": "מצב: {status}",
  "mcps.detail.error": "שגיאה: {error}",
  "mcps.button.enable": "🟢 הפעל",
  "mcps.button.disable": "🔴 השבת",
  "mcps.button.back": "⬅️ חזור",
  "mcps.auth_required": "שרת זה דורש הרשאה ואינו ניתן להפעלה מהבוט.",

  "cmd.description.rename": "שנה שם לסשן הנוכחי",

  "legacy.models.fetch_error": "🔴 קבלת רשימת המודלים נכשלה. בדוק מצב שרת עם /status.",
  "legacy.models.empty": "📋 אין מודלים זמינים. הגדר ספקים ב-OpenCode.",
  "legacy.models.header": "📋 מודלים זמינים:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ אין מודלים זמינים\n",
  "legacy.models.env_hint": "💡 לשימוש במודל ב-.env:\n",
  "legacy.models.error": "🔴 אירעה שגיאה בטעינת רשימת המודלים.",

  "stt.recognizing": "🎤 מזהה אודיו...",
  "stt.recognized": "🎤 זוהה:\n{text}",
  "stt.not_configured":
    "🎤 זיהוי קולי לא הוגדר.\n\nהגדר STT_API_URL ו-STT_API_KEY בקובץ .env כדי להפעיל.",
  "stt.error": "🔴 זיהוי האודיו נכשל: {error}",
  "stt.empty_result": "🎤 לא זוהה דיבור בהודעת האודיו.",
  "stt.confirm_message": "🎤 טקסט שזוהה:\n{text}\n\nלשלוח, לערוך או לבטל?",
  "stt.confirm_send": "✅ שלח",
  "stt.confirm_edit": "✏️ ערוך",
  "stt.confirm_cancel": "❌ בטל",
  "stt.confirm_sending": "✅ שולח טקסט מזוהה כפרומפט...",
  "stt.confirm_edit_prompt": "✏️ שלח את הטקסט המתוקן:",
  "stt.confirm_edit_sending": "✅ שולח טקסט שעודכן כפרומפט...",
  "stt.confirm_cancelled": "❌ הודעת קול בוטלה.",
  "stt.confirm_inactive": "הודעת קול זו אינה פעילה יותר.",

  "cmd.description.open": "הוסף פרויקט על ידי עיון בתיקיות",
  "worktree.branch_detached": "detached HEAD",
  "worktree.select_with_current": "בחר worktree:",
  "worktree.project_not_selected":
    "🏗 פרויקט לא נבחר.\n\nראשית בחר פרויקט עם /projects.",
  "worktree.not_git_repo":
    "🌿 Git worktrees לא זמינים עבור הפרויקט הנוכחי. בחר תחילה מאגר git.",
  "worktree.not_git_repo_callback": "הפרויקט הנוכחי אינו מאגר git",
  "worktree.empty": "📭 לא נמצאו git worktrees עבור המאגר הנוכחי.",
  "worktree.fetch_error": "🔴 טעינת git worktrees נכשלה.",
  "worktree.page_empty_callback": "אין worktrees בעמוד זה",
  "worktree.selection_missing_callback": "ה-worktree שנבחר אינו זמין יותר",
  "worktree.already_selected_callback": "worktree זה כבר נבחר",
  "worktree.selected":
    "✅ Worktree נבחר: {worktree}\n\n📋 הסשן אופס. השתמש ב-/sessions או /new להמשך.",
  "worktree.select_error": "🔴 בחירת ה-worktree נכשלה.",
  "open.back": "⬆️ למעלה",
  "open.roots": "📋 חזרה לשורשים",
  "open.prev_page": "⬅️ הקודם",
  "open.next_page": "הבא ➡️",
  "open.select_current": "✅ בחר תיקייה זו",
  "open.select_root": "📂 בחר תיקיית שורש לעיון:",
  "open.access_denied": "⛔ גישה נדחתה: הנתיב נמצא מחוץ לשורשים המותרים",
  "open.scan_error": "🔴 לא ניתן לעיין בתיקייה: {error}",
  "open.open_error": "🔴 פתיחת דפדפן התיקיות נכשלה.",
  "open.selected": "✅ פרויקט נוסף: {project}\n\n📋 השתמש ב-/sessions או /new כדי להתחיל לעבוד.",
  "open.select_error": "🔴 הוספת הפרויקט נכשלה.",
  "open.no_subfolders": "📭 אין תיקיות משנה",
  "open.subfolder_count": "תיקיית משנה אחת",
  "open.subfolders_count": "{count} תיקיות משנה",
  "ls.access_denied": "⛔ גישה נדחתה: הנתיב נמצא מחוץ לפרויקט הנוכחי",
  "ls.scan_error": "🔴 לא ניתן לרשום תיקייה",
  "ls.header": "רשימת תיקיות",
  "ls.total": "סה״כ: {count} פריטים",
  "ls.file.header": "פרטי קובץ",
  "ls.file.download": "📥 הורד",
  "ls.file.back": "⬅️ חזור",
} as const;

export type I18nKey = keyof typeof he;
export type I18nDictionary = Record<I18nKey, string>;
