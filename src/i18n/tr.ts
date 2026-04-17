import type { I18nDictionary } from "./en.js";

export const tr: I18nDictionary = {
  "cmd.description.status": "Sunucu ve oturum durumu",
  "cmd.description.new": "Yeni oturum oluştur",
  "cmd.description.stop": "Mevcut eylemi durdur",
  "cmd.description.sessions": "Oturumları listele",
  "cmd.description.tts": "Sesli yanıtları aç/kapat",
  "cmd.description.projects": "Projeleri listele",
  "cmd.description.task": "Zamanlı görev oluştur",
  "cmd.description.tasklist": "Zamanlı görevleri listele",
  "cmd.description.commands": "Özel komutlar",
  "cmd.description.opencode_start": "OpenCode sunucusunu başlat",
  "cmd.description.opencode_stop": "OpenCode sunucusunu durdur",
  "cmd.description.help": "Yardım",

  "callback.unknown_command": "Bilinmeyen komut",
  "callback.processing_error": "İşleme hatası",

  "error.load_agents": "❌ Arayecekler listesi yüklenemedi",
  "error.load_models": "❌ Modeller listesi yüklenemedi",
  "error.load_variants": "❌ Varyantlar listesi yüklenemedi",
  "error.context_button": "❌ Bağlam düğmesi işlenemedi",
  "error.generic": "🔴 Bir şeyler yanlış gitti.",

  "interaction.blocked.expired": "⚠️ Bu etkileşim süresi doldu. Lütfen yeniden başlatın.",
  "interaction.blocked.expected_callback":
    "⚠️ Bu adım için satır içi düğmeleri kullanın veya İptal'e basın.",
  "interaction.blocked.expected_text": "⚠️ Bu adım için metin mesajı gönderin.",
  "interaction.blocked.expected_command": "⚠️ Bu adım için komut gönderin.",
  "interaction.blocked.command_not_allowed":
    "⚠️ Bu komut mevcut adımda kullanılamıyor.",
  "interaction.blocked.finish_current":
    "⚠️ Önce mevcut etkileşimi bitirin (yanıtlayın veya iptal edin), ardından başka bir menü açın.",

  "inline.blocked.expected_choice": "⚠️ Bir seçenek belirlemek için satır içi düğmeleri kullanın veya İptal'e basın.",
  "inline.blocked.command_not_allowed": "⚠️ Satır içi menü aktifken bu komut kullanılamıyor.",

  "question.blocked.expected_answer":
    "⚠️ Mevcut soruyu düğmelerle, Özel Yanıt ile veya İptal ile yanıtlayın.",
  "question.blocked.command_not_allowed":
    "⚠️ Mevcut anket akışı tamamlanana kadar bu komut kullanılamaz.",

  "inline.button.cancel": "❌ İptal",
  "inline.inactive_callback": "Bu menü artık aktif değil",
  "inline.cancelled_callback": "İptal edildi",

  "common.unknown": "bilinmiyor",
  "common.unknown_error": "bilinmeyen hata",

  "start.welcome":
    "👋 OpenCode Telegram Bot'a hoş geldiniz!\n\nKomutları kullanın:\n/projects — proje seç\n/sessions — oturum listesi\n/new — yeni oturum\n/task — zamanlı görev\n/tasklist — zamanlı görevler\n/status — durum\n/help — yardım\n\nAlt düğmeleri kullanarak aracı, modeli ve varyantı seçin.",
  "help.keyboard_hint":
    "💡 Aracı, modeli, varyantı ve bağlam eylemleri için alt klavye düğmelerini kullanın.",
  "help.text":
    "📖 **Yardım**\n\n/status - Sunucu durumunu kontrol et\n/sessions - Oturum listesi\n/new - Yeni oturum oluştur\n/help - Yardım",

  "bot.thinking": "💭 Düşünüyor...",
  "bot.project_not_selected":
    "🏗 Proje seçilmedi.\n\nÖnce /projects komutuyla bir proje seçin.",
  "bot.creating_session": "🔄 Yeni oturum oluşturuluyor...",
  "bot.create_session_error":
    "🔴 Oturum oluşturulamadı. /new komutunu deneyin veya /status ile sunucu durumunu kontrol edin.",
  "bot.session_created": "✅ Oturum oluşturuldu: {title}",
  "bot.session_busy":
    "⏳ Aracı zaten bir görev çalıştırıyor. Tamamlanmasını bekleyin veya mevcut çalışmayı kesmek için /abort kullanın.",
  "bot.session_reset_project_mismatch":
    "⚠️ Aktif oturum seçili projeyle eşleşmedi, bu nedenle sıfırlandı. Bir oturum seçmek için /sessions veya yeni oturum oluşturmak için /new kullanın.",
  "bot.prompt_send_error": "OpenCode'a istek gönderilemedi.",
  "bot.session_error": "🔴 OpenCode şu hatayı döndürdü: {message}",
  "bot.session_retry":
    "🔁 {message}\n\nSağlayıcı tekrarlanan denemelerde aynı hatayı döndürmeye devam ediyor. Durdurmak için /abort kullanın.",
  "bot.unknown_command": "⚠️ Bilinmeyen komut: {command}. Kullanılabilir komutlar için /help kullanın.",
  "bot.photo_downloading": "⏳ Fotoğraf indiriliyor...",
  "bot.photo_too_large": "⚠️ Fotoğraf çok büyük (maks. {maxSizeMb}MB)",
  "bot.photo_model_no_image": "⚠️ Mevcut model resim girişini desteklemiyor. Sadece metin gönderiliyor.",
  "bot.photo_download_error": "🔴 Fotoğraf indirilemedi",
  "bot.photo_no_caption": "💡 İpucu: Bu fotoğrafla ne yapmak istediğinizi açıklamak için bir başlık ekleyin.",
  "bot.file_downloading": "⏳ Dosya indiriliyor...",
  "bot.file_too_large": "⚠️ Dosya çok büyük (maks. {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 Dosya indirilemedi",
  "bot.model_no_pdf": "⚠️ Mevcut model PDF girişini desteklemiyor. Sadece metin gönderiliyor.",
  "bot.text_file_too_large": "⚠️ Metin dosyası çok büyük (maks. {maxSizeKb}KB)",

  "status.header_running": "🟢 OpenCode Sunucusu çalışıyor",
  "status.health.healthy": "Sağlıklı",
  "status.health.unhealthy": "Sağlıksız",
  "status.line.health": "Durum: {health}",
  "status.line.version": "Sürüm: {version}",
  "status.line.managed_yes": "Bot tarafından başlatıldı: Evet",
  "status.line.managed_no": "Bot tarafından başlatıldı: Hayır",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Çalışma süresi: {seconds} saniye",
  "status.line.mode": "Aracı: {mode}",
  "status.line.model": "Model: {model}",
  "status.line.tts": "TTS yanıtları: {tts}",
  "status.tts.on": "Açık",
  "status.tts.off": "Kapalı",
  "status.agent_not_set": "belirlenmedi",
  "status.project_selected": "Proje: {project}",
  "status.project_not_selected": "Proje: seçilmedi",
  "status.project_hint": "Proje seçmek için /projects kullanın",
  "status.session_selected": "Mevcut oturum: {title}",
  "status.session_not_selected": "Mevcut oturum: seçilmedi",
  "status.session_hint": "Oturum seçmek için /sessions veya yeni oturum oluşturmak için /new kullanın",
  "status.server_unavailable":
    "🔴 OpenCode Sunucusu kullanılamıyor\n\nSunucuyu başlatmak için /opencode_start kullanın.",

  "tts.enabled": "🔊 Sesli yanıtlar genel olarak etkinleştirildi.",
  "tts.not_configured":
    "⚠️ Sesli yanıtlar kullanılamıyor. Önce `TTS_API_URL` ve `TTS_API_KEY` ayarlayın.",
  "tts.disabled": "🔇 Sesli yanıtlar genel olarak devre dışı bırak��ldı.",
  "tts.failed": "⚠️ Sesli yanıt oluşturulamadı.",

  "projects.empty":
    "📭 Proje bulunamadı.\n\nOpenCode'da bir dizin açın ve en az bir oturum oluşturun, ardından burada görünecektir.",
  "projects.select": "Proje seçin:",
  "projects.select_with_current": "Proje seçin:\n\nMevcut: 🏗 {project}",
  "projects.page_indicator": "Sayfa {current}/{total}",
  "projects.prev_page": "⬅️ Geri",
  "projects.next_page": "İleri ➡️",
  "projects.fetch_error":
    "🔴 OpenCode Sunucusu kullanılamıyor veya projeler yüklenirken bir hata oluştu.",
  "projects.page_load_error": "Bu sayfa yüklenemedi. Lütfen tekrar deneyin.",
  "projects.selected":
    "✅ Proje seçildi: {project}\n\n📋 Oturum sıfırlandı. Bu proje için /sessions veya /new kullanın.",
  "projects.select_error": "🔴 Proje seçilemedi.",

  "sessions.project_not_selected":
    "🏗 Proje seçilmedi.\n\nÖnce /projects komutuyla bir proje seçin.",
  "sessions.empty": "📭 Oturum bulunamadı.\n\n/new komutuyla yeni oturum oluşturun.",
  "sessions.select": "Oturum seçin:",
  "sessions.select_page": "Oturum seçin (sayfa {page}):",
  "sessions.fetch_error":
    "🔴 OpenCode Sunucusu kullanılamıyor veya oturumlar yüklenirken bir hata oluştu.",
  "sessions.select_project_first": "🔴 Proje seçilmedi. /projects kullanın.",
  "sessions.page_empty_callback": "Bu sayfada oturum yok",
  "sessions.page_load_error_callback":
    "Bu sayfa yüklenemedi. Lütfen tekrar deneyin.",
  "sessions.button.prev_page": "⬅️ Geri",
  "sessions.button.next_page": "İleri ➡️",
  "sessions.loading_context": "⏳ Bağlam ve en son mesajlar yükleniyor...",
  "sessions.selected": "✅ Oturum seçildi: {title}",
  "sessions.select_error": "🔴 Oturum seçilemedi.",
  "sessions.preview.empty": "En son mesaj yok.",
  "sessions.preview.title": "En son mesajlar:",
  "sessions.preview.you": "Siz:",
  "sessions.preview.agent": "Aracı:",

  "new.project_not_selected": "🏗 Proje seçilmedi.\n\nÖnce /projects komutuyla bir proje seçin.",
  "new.created": "✅ Yeni oturum oluşturuldu: {title}",
  "new.create_error": "🔴 OpenCode Sunucusu kullanılamıyor veya oturum oluşturulurken bir hata oluştu.",

  "stop.no_active_session":
    "🛑 Aracı başlatılmadı\n\n/new ile oturum oluşturun veya /sessions ile mevcut birini seçin.",
  "stop.in_progress":
    "🛑 Olay akışı durduruluyor, durdurma sinyali gönderiliyor...\n\nAracının durması bekleniyor.",
  "stop.warn_unconfirmed":
    "⚠️ Olay akışı durduruldu, ancak sunucu durdurmayı onaylamadı.\n\n/status kontrol edin ve birkaç saniye içinde /abort retry edin.",
  "stop.warn_maybe_finished":
    "⚠️ Olay akışı durduruldu, ancak aracı muhtemelen zaten bitmiş olabilir.",
  "stop.success":
    "✅ Aracı eylemi durduruldu. Bu çalıştırmadan daha fazla mesaj gelmeyecek.",
  "stop.warn_still_busy":
    "⚠️ Sinyal gönderildi, ancak aracı hala meşgul.\n\nOlay akışı zaten devre dışı, bu nedenle ara mesajlar gönderilmeyecek.",
  "stop.warn_timeout":
    "⚠️ Durdurma isteği zaman aşımına uğradı.\n\nOlay akışı zaten devre dışı, birkaç saniye içinde /abort retry edin.",
  "stop.warn_local_only":
    "⚠️ Olay akışı yerel olarak durduruldu, ancak sunucu tarafında durdurma başarısız oldu.",
  "stop.error":
    "🔴 Eylem durdurulamadı.\n\nOlay akışı durduruldu, tekrar /abort deneyin.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Sunucusu zaten çalışıyor\n\nPID: {pid}\nÇalışma süresi: {seconds} saniye",
  "opencode_start.already_running_external":
    "✅ OpenCode Sunucusu harici bir süreç olarak zaten çalışıyor\n\nSürüm: {version}\n\nBu sunucu bot tarafından başlatılmadı, bu nedenle /opencode-stop durduramaz.",
  "opencode_start.starting": "🔄 OpenCode Sunucusu başlatılıyor...",
  "opencode_start.start_error":
    "🔴 OpenCode Sunucusu başlatılamadı\n\nHata: {error}\n\nOpenCode CLI'nin yüklü ve PATH'de mevcut olduğunu kontrol edin:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Sunucusu başlatıldı, ancak yanıt vermiyor\n\nPID: {pid}\n\nSunucu hala başlıyor olabilir. Birkaç saniye içinde /status deneyin.",
  "opencode_start.success": "✅ OpenCode Sunucusu başarıyla başlatıldı\n\nPID: {pid}\nSürüm: {version}",
  "opencode_start.error":
    "🔴 Sunucu başlatılırken bir hata oluştu.\n\nAyrıntılar için uygulama günlüklerini kontrol edin.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Sunucusu harici bir süreç olarak çalışıyor\n\nBu sunucu /opencode-start ile başlatılmadı.\nDurdurmak için manuel olarak veya durumu kontrol etmek için /status kullanın.",
  "opencode_stop.not_running": "⚠️ OpenCode Sunucusu çalışmıyor",
  "opencode_stop.stopping": "🛑 OpenCode Sunucusu durduruluyor...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 OpenCode Sunucusu durdurulamadı\n\nHata: {error}",
  "opencode_stop.success": "✅ OpenCode Sunucusu başarıyla durduruldu",
  "opencode_stop.error":
    "🔴 Sunucu durdurulurken bir hata oluştu.\n\nAyrıntılar için uygulama günlüklerini kontrol edin.",

  "agent.changed_callback": "Aracı değiştirildi: {name}",
  "agent.changed_message": "✅ Aracı değiştirildi: {name}",
  "agent.change_error_callback": "Aracı değiştirilemedi",
  "agent.menu.current": "Mevcut aracı: {name}\n\nAracı seçin:",
  "agent.menu.select": "Aracı seçin:",
  "agent.menu.empty": "⚠️ Mevcut aracı yok",
  "agent.menu.error": "🔴 Arayecekler listesi alınamadı",

  "model.changed_callback": "Model değiştirildi: {name}",
  "model.changed_message": "✅ Model değiştirildi: {name}",
  "model.change_error_callback": "Model değiştirilemedi",
  "model.menu.empty": "⚠️ Mevcut model yok",
  "model.menu.select": "Model seçin:",
  "model.menu.current": "Mevcut model: {name}\n\nModel seçin:",
  "model.menu.favorites_title": "⭐ Favoriler (Modelleri OpenCode CLI'de favorilere ekleyin)",
  "model.menu.favorites_empty": "— Boş.",
  "model.menu.recent_title": "🕘 Son",
  "model.menu.recent_empty": "— Boş.",
  "model.menu.favorites_hint":
    "ℹ️ Modelleri OpenCode CLI'de favorilere ekleyin, böylece listenin en üstünde kalır.",
  "model.menu.error": "🔴 Modeller listesi alınamadı",

  "variant.model_not_selected_callback": "Hata: model seçilmedi",
  "variant.changed_callback": "Varyant değiştirildi: {name}",
  "variant.changed_message": "✅ Varyant değiştirildi: {name}",
  "variant.change_error_callback": "Varyant değiştirilemedi",
  "variant.select_model_first": "⚠️ Önce bir model seçin",
  "variant.menu.empty": "⚠️ Mevcut varyant yok",
  "variant.menu.current": "Mevcut varyant: {name}\n\nVaryant seçin:",
  "variant.menu.error": "🔴 Varyantlar listesi alınamadı",

  "context.button.confirm": "✅ Evet, bağlamı sıkıştır",
  "context.no_active_session": "⚠️ Aktif oturum yok. /new ile oturum oluşturun",
  "context.confirm_text":
    '📊 "{title}" oturumu için bağlam sıkıştırma\n\nBu, geçmişten eski mesajları kaldırarak bağlam kullanımını azaltacak. Mevcut görev kesintiye uğratılmayacak.\n\nDevam etsin mi?',
  "context.callback_session_not_found": "Oturum bulunamadı",
  "context.callback_compacting": "Bağlam sıkıştırılıyor...",
  "context.progress": "⏳ Bağlam sıkıştırılıyor...",
  "context.error": "❌ Bağlam sıkıştırma başarısız",
  "context.success": "✅ Bağlam başarıyla sıkıştırıldı",

  "permission.inactive_callback": "İzin talebi aktif değil",
  "permission.processing_error_callback": "İşleme hatası",
  "permission.no_active_request_callback": "Hata: aktif talep yok",
  "permission.reply.once": "Bir kez izin verildi",
  "permission.reply.always": "Her zaman izin verildi",
  "permission.reply.reject": "Reddedildi",
  "permission.send_reply_error": "❌ İzin yanıtı gönderilemedi",
  "permission.blocked.expected_reply":
    "⚠️ Lütfen önce yukarıdaki düğmelerle izin talebini yanıtlayın.",
  "permission.blocked.command_not_allowed":
    "⚠️ İzin talebini yanıtlayana kadar bu komut kullanılamaz.",
  "permission.header": "{emoji} İzin talebi: {name}\n\n",
  "permission.button.allow": "✅ Bir kez izin ver",
  "permission.button.always": "🔓 Her zaman izin ver",
  "permission.button.reject": "❌ Reddet",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Düzenle",
  "permission.name.write": "Yaz",
  "permission.name.read": "Oku",
  "permission.name.webfetch": "Web İndir",
  "permission.name.websearch": "Web Ara",
  "permission.name.glob": "Dosya Ara",
  "permission.name.grep": "İçerik Ara",
  "permission.name.list": "Dizin Listele",
  "permission.name.task": "Görev",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "Harici Dizin",

  "question.inactive_callback": "Anket aktif değil",
  "question.processing_error_callback": "İşleme hatası",
  "question.select_one_required_callback": "En az bir seçenek belirleyin",
  "question.enter_custom_callback": "Özel yanıtınızı mesaj olarak gönderin",
  "question.cancelled": "❌ Anket iptal edildi",
  "question.answer_already_received": "Yanıt zaten alındı, lütfen bekleyin...",
  "question.completed_no_answers": "✅ Anket tamamlandı (yanıtsız)",
  "question.no_active_project": "❌ Aktif proje yok",
  "question.no_active_request": "❌ Aktif talep yok",
  "question.send_answers_error": "❌ Yanıtlar aracıya gönderilemedi",
  "question.multi_hint": "\n(Birden fazla seçenek belirleyebilirsiniz)",
  "question.button.submit": "✅ Tamam",
  "question.button.custom": "🔤 Özel yanıt",
  "question.button.cancel": "❌ İptal",
  "question.use_custom_button_first":
    '⚠️ Metin göndermek için önce mevcut soru için "Özel yanıt" düğmesine basın.',
  "question.summary.title": "✅ Anket tamamlandı!\n\n",
  "question.summary.question": "Soru {index}:\n{question}\n\n",
  "question.summary.answer": "Yanıt:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Aracı",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Varsayılan",
  "keyboard.updated": "⌨️ Klavye güncellendi",

  "pinned.default_session_title": "yeni oturum",
  "pinned.unknown": "Bilinmiyor",
  "pinned.line.project": "Proje: {project}",
  "pinned.line.model": "Model: {model}",
  "pinned.line.context": "Bağlam: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "Maliyet: {cost} harcandı",
  "subagent.header": "Alt aracı {agent}: {description}",
  "subagent.line.status": "Durum: {status}",
  "subagent.line.task": "Görev: {task}",
  "subagent.line.agent": "Aracı: {agent}",
  "subagent.working": "Çalışıyor...",
  "subagent.working_with_details": "Çalışıyor: {details}",
  "subagent.completed": "Tamamlandı",
  "subagent.failed": "Görev başarısız",
  "subagent.status.pending": "bekliyor",
  "subagent.status.running": "çalışıyor",
  "subagent.status.completed": "tamamlandı",
  "subagent.status.error": "hata",
  "pinned.files.title": "Dosyalar ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... ve {count} daha",

  "tool.todo.overflow": "*({count} daha görev)*",
  "tool.file_header.write":
    "Dosya/Yol Yaz: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Dosya/Yol Düzenle: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Telegram bot tokenınızı girin (@BotFather'dan alın).\n> ",
  "runtime.wizard.ask_language":
    "Arayüz dilini seçin.\nListeden dil numarasını veya yerel ayar kodunu girin.\nVarsayılan dili kullanmak için Enter'a basın: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "Listedeki dil numarasını veya desteklenen yerel ayar kodunu girin.\n",
  "runtime.wizard.language_selected": "Seçilen dil: {language}\n",
  "runtime.wizard.token_required": "Token gerekli. Lütfen tekrar deneyin.\n",
  "runtime.wizard.token_invalid":
    "Token geçersiz görünüyor (beklenen biçim <id>:<secret>). Lütfen tekrar deneyin.\n",
  "runtime.wizard.ask_user_id":
    "Telegram Kullanıcı ID'nizi girin (@userinfobot'dan alabilirsiniz).\n> ",
  "runtime.wizard.user_id_invalid": "Pozitif bir tam sayı girin (> 0).\n",
  "runtime.wizard.ask_api_url":
    "OpenCode API URL'sini girin (opsiyonel).\nVarsayılanı kullanmak için Enter'a basın: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "OpenCode sunucu kullanıcı adını girin (opsiyonel).\nVarsayılanı kullanmak için Enter'a basın: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "OpenCode sunucu şifresini girin (opsiyonel).\nBoş bırakmak için Enter'a basın.\n> ",
  "runtime.wizard.api_url_invalid": "Geçerli bir URL (http/https) girin veya varsayılan için Enter'a basın.\n",
  "runtime.wizard.start": "OpenCode Telegram Bot kurulumu.\n",
  "runtime.wizard.saved": "Yapılandırma kaydedildi:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Uygulama henüz yapılandırılmadı. Sihirbaz başlatılıyor...\n",
  "runtime.wizard.tty_required":
    "Etkileşimli sihirbaz bir TTY terminali gerektirir. Etkileşimli kabukta `opencode-telegram config` çalıştırın.",

  "rename.no_session": "⚠️ Aktif oturum yok. Önce bir oturum oluşturun veya seçin.",
  "rename.prompt": "📝 Oturum için yeni başlık girin:\n\nMevcut: {title}",
  "rename.empty_title": "⚠️ Başlık boş olamaz.",
  "rename.success": "✅ Oturum şu şekilde yeniden adlandırıldı: {title}",
  "rename.error": "🔴 Oturum yeniden adlandırılamadı.",
  "rename.cancelled": "❌ Yeniden adlandırma iptal edildi.",
  "rename.inactive_callback": "Yeniden adlandırma talebi aktif değil",
  "rename.inactive": "⚠️ Yeniden adlandırma talebi aktif değil. /rename tekrar çalıştırın.",
  "rename.blocked.expected_name":
    "⚠️ Yeni oturum adını metin olarak girin veya yeniden adlandırma mesajında İptal'e basın.",
  "rename.blocked.command_not_allowed":
    "⚠️ Yeniden adlandırma yeni bir isim beklerken bu komut kullanılamaz.",
  "rename.button.cancel": "❌ İptal",

  "task.prompt.schedule":
    "⏰ Görev planını doğal dilde gönderin.\n\nÖrnekler:\n- her 5 dakikada\n- her gün 17:00'de\n- yarın 12:00'de",
  "task.schedule_empty": "⚠️ Plan boş olamaz.",
  "task.parse.in_progress": "⏳ Plan ayrıştırılıyor...",
  "task.parse_error":
    "🔴 Plan ayrıştırılamadı.\n\n{message}\n\nPlanı daha net bir biçimde tekrar gönderin.",
  "task.schedule_preview":
    "✅ Plan ayrıştırıldı\n\nAnladığım şekli: {summary}\n{cronLine}Saat dilimi: {timezone}\nTür: {kind}\nSonraki çalışma: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 Şimdi botun planlı görevde ne yapması gerektiğini gönderin.",
  "task.prompt_empty": "⚠️ Görev metni boş olamaz.",
  "task.created":
    "✅ Zamanlı görev oluşturuldu\n\nGörev: {description}\nProje: {project}\nModel: {model}\nPlan: {schedule}\n{cronLine}Sonraki çalışma: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 Planı yeniden gir",
  "task.button.cancel": "❌ İptal",
  "task.retry_schedule_callback": "Plan girişi yeniden yapılıyor...",
  "task.cancel_callback": "İptal ediliyor...",
  "task.cancelled": "❌ Zamanlı görev oluşturma iptal edildi.",
  "task.inactive_callback": "Bu zamanlı görev akışı artık aktif değil",
  "task.inactive": "⚠️ Zamanlı görev oluşturma aktif değil. /task tekrar çalıştırın.",
  "task.blocked.expected_input":
    "⚠️ Önce mevcut zamanlı görev kurulumunu plan mesajında metin göndererek veya düğmeyi kullanarak bitirin.",
  "task.blocked.command_not_allowed":
    "⚠️ Zamanlı görev oluşturma aktifken bu komut kullanılamaz.",
  "task.limit_reached": "⚠️ Görev sınırına ulaşıldı ({limit}). Önce mevcut bir zamanlı görevi silin.",
  "task.schedule_too_frequent":
    "Tekrarlayan plan çok sık. İzin verilen minimum aralık 5 dakikada bir.",
  "task.kind.cron": "tekrarlayan",
  "task.kind.once": "tek seferlik",
  "task.run.success": "⏰ Zamanlı görev tamamlandı: {description}",
  "task.run.error": "🔴 Zamanlı görev başarısız: {description}\n\nHata: {error}",

  "tasklist.empty": "📭 Henüz zamanlı görev yok.",
  "tasklist.select": "Zamanlı görev seçin:",
  "tasklist.details":
    "⏰ Zamanlı görev\n\nGörev: {prompt}\nProje: {project}\nPlan: {schedule}\n{cronLine}Saat dilimi: {timezone}\nSonraki çalışma: {nextRunAt}\nSon çalışma: {lastRunAt}\nÇalışma sayısı: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 Sil",
  "tasklist.button.cancel": "❌ İptal",
  "tasklist.deleted_callback": "Silindi",
  "tasklist.cancelled_callback": "İptal edildi",
  "tasklist.inactive_callback": "Bu zamanlı görev menüsü artık aktif değil",
  "tasklist.load_error": "🔴 Zamanlı görevler yüklenemedi.",

  "commands.select": "OpenCode komutu seçin:",
  "commands.empty": "📭 Bu proje için OpenCode komutu yok.",
  "commands.fetch_error": "🔴 OpenCode komutları yüklenemedi.",
  "commands.no_description": "Açıklama yok",
  "commands.button.execute": "✅ Çalıştır",
  "commands.button.cancel": "❌ İptal",
  "commands.confirm":
    "{command} komutunun çalıştırılmasını onaylayın. Bağımsız değişkenlerle çalıştırmak için bağımsız değişkenleri mesaj olarak gönderin.",
  "commands.inactive_callback": "Bu komut menüsü artık aktif değil",
  "commands.cancelled_callback": "İptal edildi",
  "commands.execute_callback": "Komut çalıştırılıyor...",
  "commands.executing_prefix": "⚡ Komut çalıştırılıyor:",
  "commands.arguments_empty":
    "⚠️ Bağımsız değişkenler boş olamaz. Metin gönderin veya Çalıştır'a basın.",
  "commands.execute_error": "🔴 OpenCode komutu çalıştırılamadı.",
  "commands.select_page": "OpenCode komutu seçin (sayfa {page}):",
  "commands.button.prev_page": "⬅️ Geri",
  "commands.button.next_page": "İleri ➡️",
  "commands.page_empty_callback": "Bu sayfada komut yok",
  "commands.page_load_error_callback":
    "Bu sayfa yüklenemedi. Lütfen tekrar deneyin.",

  "cmd.description.rename": "Mevcut oturumu yeniden adlandır",

  "cli.usage":
    "Kullanım:\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nNotlar:\n  - Komut yoksa varsayılan olarak `start` kullanılır\n  - `--mode` şu anda sadece `start` için destekleniyor",
  "cli.placeholder.status":
    "`status` komutu şu anda bir yer tutucudur. Gerçik durum kontrolleri hizmet katmanında (Faz 5) eklenecektir.",
  "cli.placeholder.stop":
    "`stop` komutu şu anda bir yer tutucudur. Arka plan işlemi durdurma hizmet katmanında (Faz 5) eklenecektir.",
  "cli.placeholder.unavailable": "Komut kullanılamıyor.",
  "cli.error.prefix": "CLI hatası: {message}",
  "cli.args.unknown_command": "Bilinmeyen komut: {value}",
  "cli.args.mode_requires_value": "--mode seçeneği bir değer gerektirir: sources|installed",
  "cli.args.invalid_mode": "Geçersiz mode değeri: {value}. sources|installed bekleniyor",
  "cli.args.unknown_option": "Bilinmeyen seçenek: {value}",
  "cli.args.mode_only_start": "--mode seçeneği sadece start komutu için destekleniyor",

  "legacy.models.fetch_error":
    "🔴 Modeller listesi alınamadı. Sunucu durumunu /status ile kontrol edin.",
  "legacy.models.empty": "📋 Mevcut model yok. Sağlayıcıları OpenCode'da yapılandırın.",
  "legacy.models.header": "📋 Mevcut modeller:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ Mevcut model yok\n",
  "legacy.models.env_hint": "💡 .env'de model kullanmak için:\n",
  "legacy.models.error": "🔴 Modeller listesi yüklenirken bir hata oluştu.",

  "stt.recognizing": "🎤 Ses tanınıyor...",
  "stt.recognized": "🎤 Tanındı:\n{text}",
  "stt.not_configured":
    "🎤 Ses tanıma yapılandırılmadı.\n\nEtkinleştirmek için .env'de STT_API_URL ve STT_API_KEY ayarlayın.",
  "stt.error": "🔴 Ses tanınamadı: {error}",
  "stt.empty_result": "🎤 Ses mesajında konuşma tespit edilmedi.",

  "cmd.description.open": "Dizinlere göz atarak proje ekle",
  "open.back": "⬆️ Yukarı",
  "open.roots": "📋 Köklere geri dön",
  "open.prev_page": "⬅️ Geri",
  "open.next_page": "İleri ➡️",
  "open.select_current": "✅ Bu klasörü seç",
  "open.select_root": "📂 Göz atmak için kök dizin seçin:",
  "open.access_denied": "⛔ Erişim reddedildi: yol izin verilen köklerin dışında",
  "open.scan_error": "🔴 Dizin taranamadı: {error}",
  "open.open_error": "🔴 Dizin tarayıcısı açılamadı.",
  "open.selected": "✅ Proje eklendi: {project}\n\n📋 Çalışmaya başlamak için /sessions veya /new kullanın.",
  "open.select_error": "🔴 Proje eklenemedi.",
  "open.no_subfolders": "📭 Alt klasör yok",
  "open.subfolder_count": "{count} alt klasör",
  "open.subfolders_count": "{count} alt klasör",
};