import type { I18nDictionary } from "./en.js";

export const ko: I18nDictionary = {
  "cmd.description.status": "서버 및 세션 상태",
  "cmd.description.new": "새 세션 생성",
  "cmd.description.stop": "현재 작업 중단",
  "cmd.description.detach": "현재 세션에서 분리",
  "cmd.description.sessions": "세션 목록",
  "cmd.description.tts": "음성 답변 토글",
  "cmd.description.projects": "프로젝트 목록",
  "cmd.description.worktree": "Git 워크트리 전환",
  "cmd.description.task": "예약 작업 생성",
  "cmd.description.tasklist": "예약 작업 목록",
  "cmd.description.commands": "커스텀 명령어",
  "cmd.description.skills": "스킬 카탈로그",
  "cmd.description.mcps": "MCP 서버",
  "cmd.description.opencode_start": "OpenCode 서버 시작",
  "cmd.description.opencode_stop": "OpenCode 서버 중지",
  "cmd.description.ls": "디렉토리 목록 보기",
  "cmd.description.help": "도움말",

  "callback.unknown_command": "알 수 없는 명령어",
  "callback.processing_error": "처리 오류",

  "error.load_agents": "❌ 에이전트 목록을 불러오지 못했어요",
  "error.load_models": "❌ 모델 목록을 불러오지 못했어요",
  "error.load_variants": "❌ 변형 목록을 불러오지 못했어요",
  "error.context_button": "❌ 컨텍스트 버튼 처리에 실패했어요",
  "error.generic": "🔴 문제가 발생했어요.",

  "interaction.blocked.expired": "⚠️ 이 상호작용이 만료되었어요. 다시 시작해주세요.",
  "interaction.blocked.expected_callback":
    "⚠️ 이 단계에서는 인라인 버튼을 사용하거나 취소를 눌러주세요.",
  "interaction.blocked.expected_text": "⚠️ 이 단계에서는 텍스트 메시지를 보내주세요.",
  "interaction.blocked.expected_command": "⚠️ 이 단계에서는 명령어를 보내주세요.",
  "interaction.blocked.command_not_allowed":
    "⚠️ 현재 단계에서는 이 명령어를 사용할 수 없어요.",
  "interaction.blocked.finish_current":
    "⚠️ 먼저 현재 상호작용을 완료해주세요(답변 또는 취소). 그 후 다른 메뉴를 열 수 있어요.",

  "inline.blocked.expected_choice": "⚠️ 인라인 버튼으로 옵션을 선택하거나 취소를 눌러주세요.",
  "inline.blocked.command_not_allowed":
    "⚠️ 인라인 메뉴가 활성화된 동안에는 이 명령어를 사용할 수 없어요.",

  "question.blocked.expected_answer":
    "⚠️ 버튼, 커스텀 답변, 또는 취소로 현재 질문에 답해주세요.",
  "question.blocked.command_not_allowed":
    "⚠️ 현재 질문 흐름이 완료될 때까지 이 명령어를 사용할 수 없어요.",

  "inline.button.cancel": "❌ 취소",
  "inline.inactive_callback": "이 메뉴는 비활성 상태예요",
  "inline.cancelled_callback": "취소되었어요",

  "common.unknown": "알 수 없음",
  "common.unknown_error": "알 수 없는 오류",

  "start.welcome":
    "👋 OpenCode 텔레그램 봇에 오신 것을 환영해요!\n\n명령어:\n/projects — 프로젝트 선택\n/sessions — 세션 목록\n/new — 새 세션\n/commands — 커스텀 명령어\n/skills — 스킬 카탈로그\n/task — 예약 작업\n/tasklist — 예약 작업 목록\n/status — 상태\n/help — 도움말\n\n하단 버튼으로 에이전트, 모델, 변형을 선택할 수 있어요.",
  "help.keyboard_hint":
    "💡 하단 키보드 버튼으로 에이전트, 모델, 변형, 컨텍스트 작업을 선택할 수 있어요.",
  "help.text":
    "📖 **도움말**\n\n/status - 서버 상태 확인\n/sessions - 세션 목록\n/new - 새 세션 생성\n/help - 도움말",

  "bot.thinking": "💭 생각 중...",
  "bot.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "bot.creating_session": "🔄 새 세션을 생성하는 중...",
  "bot.create_session_error":
    "🔴 세션 생성에 실패했어요. /new로 다시 시도하거나 /status로 서버 상태를 확인해주세요.",
  "bot.session_created": "✅ 세션이 생성되었어요: {title}",
  "bot.session_busy":
    "⏳ 에이전트가 이미 작업 중이에요. 완료될 때까지 기다리거나 /abort로 중단해주세요.",
  "bot.session_reset_project_mismatch":
    "⚠️ 활성 세션이 선택된 프로젝트와 일치하지 않아 초기화되었어요. /sessions으로 선택하거나 /new로 새로 만들어주세요.",
  "bot.prompt_send_error": "OpenCode로 요청을 보내지 못했어요.",
  "bot.session_error": "🔴 OpenCode에서 오류가 반환되었어요: {message}",
  "bot.session_retry":
    "🔁 {message}\n\n재시도 시 프로바이더가 계속 같은 오류를 반환하고 있어요. /abort로 중단해주세요.",
  "bot.external_user_input": "외부 사용자 입력",
  "background.session_fallback": "세션 {id}",
  "background.assistant_response": "🔔 백그라운드 세션에서 어시스턴트가 답변했어요: {session}",
  "background.question_asked": "❓ 백그라운드 세션에서 답변이 필요해요: {session}",
  "background.permission_asked": "🔐 백그라운드 세션에서 권한을 요청했어요: {session}",
  "background.open_session_button": "세션 열기",
  "bot.unknown_command": "⚠️ 알 수 없는 명령어: {command}. /help에서 사용 가능한 명령어를 확인해주세요.",
  "bot.photo_downloading": "⏳ 사진을 다운로드하는 중...",
  "bot.photo_too_large": "⚠️ 사진이 너무 커요 (최대 {maxSizeMb}MB)",
  "bot.photo_model_no_image": "⚠️ 현재 모델은 이미지 입력을 지원하지 않아요. 텍스트만 전송해요.",
  "bot.photo_download_error": "🔴 사진 다운로드에 실패했어요",
  "bot.photo_no_caption": "💡 팁: 이 사진으로 무엇을 하고 싶은지 캡션을 추가해주세요.",
  "bot.file_downloading": "⏳ 파일을 다운로드하는 중...",
  "bot.file_too_large": "⚠️ 파일이 너무 커요 (최대 {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 파일 다운로드에 실패했어요",
  "bot.model_no_pdf": "⚠️ 현재 모델은 PDF 입력을 지원하지 않아요. 텍스트만 전송해요.",
  "bot.text_file_too_large": "⚠️ 텍스트 파일이 너무 커요 (최대 {maxSizeKb}KB)",

  "status.header_running": "🟢 OpenCode 서버가 실행 중이에요",
  "status.health.healthy": "정상",
  "status.health.unhealthy": "비정상",
  "status.line.health": "상태: {health}",
  "status.line.version": "버전: {version}",
  "status.line.managed_yes": "봇에서 시작됨: 예",
  "status.line.managed_no": "봇에서 시작됨: 아니요",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "가동 시간: {seconds}초",
  "status.line.mode": "에이전트: {mode}",
  "status.line.model": "모델: {model}",
  "status.line.tts": "TTS 답변: {tts}",
  "status.tts.on": "켜짐",
  "status.tts.off": "꺼짐",
  "status.agent_not_set": "설정 안 됨",
  "status.project_selected": "프로젝트: {project}",
  "status.worktree_selected": "워크트리: {worktree}",
  "status.project_not_selected": "프로젝트: 선택 안 됨",
  "status.project_hint": "/projects로 프로젝트를 선택해주세요",
  "status.session_selected": "현재 세션: {title}",
  "status.session_not_selected": "현재 세션: 선택 안 됨",
  "status.session_hint": "/sessions으로 선택하거나 /new로 새로 만들어주세요",
  "status.server_unavailable":
    "🔴 OpenCode 서버를 사용할 수 없어요\n\n/opencode_start로 서버를 시작해주세요.",

  "tts.enabled": "🔊 음성 답변이 전역적으로 활성화되었어요.",
  "tts.not_configured":
    "⚠️ 음성 답변을 사용할 수 없어요. 먼저 `TTS_API_URL`과 `TTS_API_KEY`를 설정해주세요.",
  "tts.disabled": "🔇 음성 답변이 전역적으로 비활성화되었어요.",
  "tts.failed": "⚠️ 음성 답변 생성에 실패했어요.",

  "projects.empty":
    "📭 프로젝트를 찾을 수 없어요.\n\nOpenCode에서 디렉토리를 열고 최소 하나의 세션을 만들면 여기에 나타나요.",
  "projects.select": "프로젝트를 선택해주세요:",
  "projects.select_with_current": "프로젝트를 선택해주세요:\n\n현재: 🏗 {project}",
  "projects.page_indicator": "{current}/{total} 페이지",
  "projects.prev_page": "⬅️ 이전",
  "projects.next_page": "다음 ➡️",
  "projects.fetch_error":
    "🔴 OpenCode 서버를 사용할 수 없거나 프로젝트 로딩 중 오류가 발생했어요.",
  "projects.page_load_error": "이 페이지를 불러올 수 없어요. 다시 시도해주세요.",
  "projects.selected":
    "✅ 프로젝트가 선택되었어요: {project}\n\n📋 세션이 초기화되었어요. 이 프로젝트의 /sessions 또는 /new를 사용해주세요.",
  "projects.select_error": "🔴 프로젝트 선택에 실패했어요.",

  "sessions.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "sessions.empty": "📭 세션을 찾을 수 없어요.\n\n/new로 새 세션을 만들어주세요.",
  "sessions.select": "세션을 선택해주세요:",
  "sessions.select_page": "세션을 선택해주세요 ({page} 페이지):",
  "sessions.fetch_error":
    "🔴 OpenCode 서버를 사용할 수 없거나 세션 로딩 중 오류가 발생했어요.",
  "sessions.select_project_first": "🔴 프로젝트가 선택되지 않았어요. /projects를 사용해주세요.",
  "sessions.page_empty_callback": "이 페이지에 세션이 없어요",
  "sessions.page_load_error_callback": "이 페이지를 불러올 수 없어요. 다시 시도해주세요.",
  "sessions.button.prev_page": "⬅️ 이전",
  "sessions.button.next_page": "다음 ➡️",
  "sessions.loading_context": "⏳ 컨텍스트와 최신 메시지를 불러오는 중...",
  "sessions.selected": "✅ 세션이 선택되었어요: {title}",
  "sessions.select_error": "🔴 세션 선택에 실패했어요.",
  "sessions.preview.empty": "최근 메시지가 없어요.",
  "sessions.preview.title": "최근 메시지:",
  "sessions.preview.you": "나:",
  "sessions.preview.agent": "에이전트:",

  "attach.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "attach.session_not_selected":
    "💬 세션이 선택되지 않았어요.\n\n먼저 /sessions로 세션을 선택해주세요.",
  "attach.session_project_mismatch":
    "⚠️ 선택된 세션이 현재 프로젝트와 일치하지 않아요. /sessions에서 다시 선택해주세요.",
  "attach.connected": "✅ 세션에 연결되었어요: {title}",
  "attach.already_connected": "ℹ️ 이미 세션에 연결되어 있어요: {title}",
  "attach.status.idle_message": "상태: 대기 중. 새 이벤트를 기다리는 중이에요.",
  "attach.status.busy_message": "상태: 작업 중. 새 프롬프트가 일시적으로 차단되었어요.",
  "attach.restored_question": "이 세션의 대기 중인 질문을 복원했어요.",
  "attach.restored_permissions": "대기 중인 권한 요청을 복원했어요: {count}개.",
  "attach.disconnect_hint": "연결을 끊으려면 다른 세션이나 프로젝트로 전환해주세요.",
  "attach.error": "🔴 현재 세션에 연결하지 못했어요.",

  "detach.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "detach.no_active_session": "ℹ️ 봇이 이미 모든 세션에서 분리되어 있어요.",
  "detach.success":
    "✅ 세션에서 분리되었어요: {title}\n\nOpenCode 세션은 중지되지 않았어요. 아직 실행 중이라면 별도로 계속 진행돼요. 나중에 다시 확인하려면 /sessions에서 선택해주세요.",
  "detach.error": "🔴 현재 세션에서 분리하지 못했어요.",

  "new.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "new.created": "✅ 새 세션이 생성되었어요: {title}",
  "new.create_error":
    "🔴 OpenCode 서버를 사용할 수 없거나 세션 생성 중 오류가 발생했어요.",

  "stop.no_active_session":
    "🛑 에이전트가 시작되지 않았어요\n\n/new로 세션을 만들거나 /sessions에서 선택해주세요.",
  "stop.in_progress":
    "🛑 이벤트 스트림이 중지되었고, 중단 신호를 보내는 중...\n\n에이전트가 중지될 때까지 기다려주세요.",
  "stop.warn_unconfirmed":
    "⚠️ 이벤트 스트림이 중지되었지만, 서버가 중단을 확인하지 않았어요.\n\n/status를 확인하고 몇 초 후 /abort를 다시 시도해주세요.",
  "stop.warn_maybe_finished": "⚠️ 이벤트 스트림이 중지되었지만, 에이전트가 이미 완료되었을 수 있어요.",
  "stop.success": "✅ 에이전트 작업이 중단되었어요. 이번 실행에서 더 이상 메시지가 전송되지 않아요.",
  "stop.warn_still_busy":
    "⚠️ 신호가 전송되었지만, 에이전트가 여전히 작업 중이에요.\n\n이벤트 스트림이 이미 비활성화되어 중간 메시지는 전송되지 않아요.",
  "stop.warn_timeout":
    "⚠️ 중단 요청 시간이 초과되었어요.\n\n이벤트 스트림이 이미 비활성화되어 몇 초 후 /abort를 다시 시도해주세요.",
  "stop.warn_local_only": "⚠️ 이벤트 스트림이 로컬에서 중지되었지만, 서버 측 중단에 실패했어요.",
  "stop.error": "🔴 작업 중단에 실패했어요.\n\n이벤트 스트림이 중지되었어요. /abort를 다시 시도해주세요.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode 서버가 이미 실행 중이에요\n\nPID: {pid}\n가동 시간: {seconds}초",
  "opencode_start.already_running_external":
    "✅ OpenCode 서버가 외부 프로세스로 이미 실행 중이에요\n\n버전: {version}\n\n이 서버는 봇에서 시작되지 않았으므로 /opencode-stop으로 중지할 수 없어요.",
  "opencode_start.already_running": "✅ OpenCode 서버가 이미 실행 중이에요\n\n버전: {version}",
  "opencode_start.remote_configured": "⚠️ /opencode_start는 로컬 OpenCode 서버에서만 작동해요.",
  "opencode_start.starting": "🔄 OpenCode 서버를 시작하는 중...",
  "opencode_start.start_error":
    "🔴 OpenCode 서버 시작에 실패했어요\n\n오류: {error}\n\nOpenCode CLI가 설치되어 있고 PATH에서 사용 가능한지 확인해주세요:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode 서버가 시작되었지만, 응답하지 않아요\n\nPID: {pid}\n\n서버가 아직 시작 중일 수 있어요. 몇 초 후 /status를 확인해주세요.",
  "opencode_start.success":
    "✅ OpenCode 서버가 성공적으로 시작되었어요\n\nPID: {pid}\n버전: {version}",
  "opencode_start.error":
    "🔴 서버 시작 중 오류가 발생했어요.\n\n자세한 내용은 애플리케이션 로그를 확인해주세요.",
  "opencode_stop.external_running":
    "⚠️ OpenCode 서버가 외부 프로세스로 실행 중이에요\n\n이 서버는 /opencode-start로 시작되지 않았어요.\n수동으로 중지하거나 /status로 상태를 확인해주세요.",
  "opencode_stop.remote_configured": "⚠️ /opencode_stop는 로컬 OpenCode 서버에서만 작동해요.",
  "opencode_stop.not_running": "⚠️ OpenCode 서버가 실행 중이 아니에요",
  "opencode_stop.pid_not_found":
    "⚠️ OpenCode 서버가 포트 {port}에서 응답하지만, 중지할 로컬 프로세스를 찾을 수 없어요.",
  "opencode_stop.stopping": "🛑 OpenCode 서버를 중지하는 중...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 OpenCode 서버 중지에 실패했어요\n\n오류: {error}",
  "opencode_stop.still_running": "중지 요청 후에도 서버가 여전히 응답하고 있어요.",
  "opencode_stop.success": "✅ OpenCode 서버가 성공적으로 중지되었어요",
  "opencode_stop.error":
    "🔴 서버 중지 중 오류가 발생했어요.\n\n자세한 내용은 애플리케이션 로그를 확인해주세요.",

  "agent.changed_callback": "에이전트 변경됨: {name}",
  "agent.changed_message": "✅ 에이전트가 변경되었어요: {name}",
  "agent.change_error_callback": "에이전트 변경에 실패했어요",
  "agent.menu.current": "현재 에이전트: {name}\n\n에이전트를 선택해주세요:",
  "agent.menu.select": "에이전트를 선택해주세요:",
  "agent.menu.empty": "⚠️ 사용 가능한 에이전트가 없어요",
  "agent.menu.error": "🔴 에이전트 목록을 가져오지 못했어요",

  "model.changed_callback": "모델 변경됨: {name}",
  "model.changed_message": "✅ 모델이 변경되었어요: {name}",
  "model.change_error_callback": "모델 변경에 실패했어요",
  "model.menu.empty": "⚠️ 사용 가능한 모델이 없어요",
  "model.menu.select": "모델을 선택해주세요:",
  "model.menu.current": "현재 모델: {name}\n\n모델을 선택해주세요:",
  "model.menu.favorites_title": "⭐ 즐겨찾기 (OpenCode CLI에서 모델을 즐겨찾기에 추가해요)",
  "model.menu.favorites_empty": "— 비어 있어요.",
  "model.menu.recent_title": "🕘 최근 사용",
  "model.menu.recent_empty": "— 비어 있어요.",
  "model.menu.favorites_hint":
    "ℹ️ OpenCode CLI에서 모델을 즐겨찾기에 추가하면 상단에 고정돼요.",
  "model.menu.error": "🔴 모델 목록을 가져오지 못했어요",

  "variant.model_not_selected_callback": "오류: 모델이 선택되지 않았어요",
  "variant.changed_callback": "변형 변경됨: {name}",
  "variant.changed_message": "✅ 변형이 변경되었어요: {name}",
  "variant.change_error_callback": "변형 변경에 실패했어요",
  "variant.select_model_first": "⚠️ 먼저 모델을 선택해주세요",
  "variant.menu.empty": "⚠️ 사용 가능한 변형이 없어요",
  "variant.menu.current": "현재 변형: {name}\n\n변형을 선택해주세요:",
  "variant.menu.error": "🔴 변형 목록을 가져오지 못했어요",

  "context.button.confirm": "✅ 네, 컨텍스트 압축",
  "context.no_active_session": "⚠️ 활성 세션이 없어요. /new로 세션을 만들어주세요",
  "context.confirm_text":
    '📊 세션 "{title}"의 컨텍스트 압축\n\n기록에서 오래된 메시지를 제거하여 컨텍스트 사용량을 줄여요. 현재 작업은 중단되지 않아요.\n\n계속할까요?',
  "context.callback_session_not_found": "세션을 찾을 수 없어요",
  "context.callback_compacting": "컨텍스트 압축 중...",
  "context.progress": "⏳ 컨텍스트 압축 중...",
  "context.error": "❌ 컨텍스트 압축에 실패했어요",
  "context.success": "✅ 컨텍스트가 성공적으로 압축되었어요",

  "permission.inactive_callback": "권한 요청이 비활성 상태예요",
  "permission.processing_error_callback": "처리 오류",
  "permission.no_active_request_callback": "오류: 활성 요청이 없어요",
  "permission.reply.once": "한 번 허용",
  "permission.reply.always": "항상 허용",
  "permission.reply.reject": "거부",
  "permission.send_reply_error": "❌ 권한 응답 전송에 실패했어요",
  "permission.blocked.expected_reply":
    "⚠️ 먼저 위의 버튼으로 권한 요청에 답해주세요.",
  "permission.blocked.command_not_allowed":
    "⚠️ 권한 요청에 답변할 때까지 이 명령어를 사용할 수 없어요.",
  "permission.header": "{emoji} 권한 요청: {name}\n\n",
  "permission.button.allow": "✅ 한 번 허용",
  "permission.button.always": "🔓 항상 허용",
  "permission.button.reject": "❌ 거부",
  "permission.name.bash": "Bash",
  "permission.name.edit": "편집",
  "permission.name.write": "쓰기",
  "permission.name.read": "읽기",
  "permission.name.webfetch": "웹 가져오기",
  "permission.name.websearch": "웹 검색",
  "permission.name.glob": "파일 검색",
  "permission.name.grep": "내용 검색",
  "permission.name.list": "디렉토리 목록",
  "permission.name.task": "작업",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "외부 디렉토리",

  "question.inactive_callback": "투표가 비활성 상태예요",
  "question.processing_error_callback": "처리 오류",
  "question.select_one_required_callback": "최소 하나의 옵션을 선택해주세요",
  "question.enter_custom_callback": "커스텀 답변을 메시지로 보내주세요",
  "question.cancelled": "❌ 투표가 취소되었어요",
  "question.answer_already_received": "답변이 이미 접수되었어요. 잠시만 기다려주세요...",
  "question.completed_no_answers": "✅ 투표가 완료되었어요 (답변 없음)",
  "question.no_active_project": "❌ 활성 프로젝트가 없어요",
  "question.no_active_request": "❌ 활성 요청이 없어요",
  "question.send_answers_error": "❌ 에이전트에게 답변 전송에 실패했어요",
  "question.multi_hint": "\n(여러 옵션을 선택할 수 있어요)",
  "question.button.submit": "✅ 완료",
  "question.button.custom": "🔤 커스텀 답변",
  "question.button.cancel": "❌ 취소",
  "question.use_custom_button_first":
    '⚠️ 텍스트를 보내려면 먼저 현재 질문의 "커스텀 답변"을 눌러주세요.',
  "question.summary.title": "✅ 투표가 완료되었어요!\n\n",
  "question.summary.question": "질문 {index}:\n{question}\n\n",
  "question.summary.answer": "답변:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} 에이전트",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 기본",
  "keyboard.updated": "⌨️ 키보드가 업데이트되었어요",

  "pinned.default_session_title": "새 세션",
  "pinned.unknown": "알 수 없음",
  "pinned.line.project": "프로젝트: {project}",
  "pinned.line.worktree": "워크트리: {worktree}",
  "pinned.line.model": "모델: {model}",
  "pinned.line.attach": "추적 중: {status}",
  "pinned.attach.status.idle": "활성, 대기 중",
  "pinned.attach.status.busy": "활성, 작업 중",
  "pinned.line.context": "컨텍스트: {used} / {limit} ({percent}%)",
  "pinned.line.cost": "비용: {cost} 사용",
  "subagent.header": "서브에이전트 {agent}: {description}",
  "subagent.line.status": "상태: {status}",
  "subagent.line.task": "작업: {task}",
  "subagent.line.agent": "에이전트: {agent}",
  "subagent.working": "작업 중...",
  "subagent.working_with_details": "작업 중: {details}",
  "subagent.completed": "완료",
  "subagent.failed": "작업 실패",
  "subagent.status.pending": "대기 중",
  "subagent.status.running": "실행 중",
  "subagent.status.completed": "완료",
  "subagent.status.error": "오류",
  "pinned.files.title": "파일 ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... 외 {count}개",

  "tool.todo.overflow": "*({count}개 추가 작업)*",
  "tool.file_header.write":
    "파일 쓰기/경로: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "파일 편집/경로: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Telegram 봇 토큰을 입력해주세요 (@BotFather에서 받을 수 있어요).\n> ",
  "runtime.wizard.ask_language":
    "인터페이스 언어를 선택해주세요.\n목록에서 언어 번호를 입력하거나 로케일 코드를 입력해주세요.\nEnter를 누르면 기본 언어가 유지돼요: {defaultLocale}\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "목록에서 언어 번호 또는 지원되는 로케일 코드를 입력해주세요.\n",
  "runtime.wizard.language_selected": "선택된 언어: {language}\n",
  "runtime.wizard.token_required": "토큰은 필수예요. 다시 입력해주세요.\n",
  "runtime.wizard.token_invalid":
    "토큰 형식이 올바르지 않아요 (<id>:<secret> 형식이어야 해요). 다시 입력해주세요.\n",
  "runtime.wizard.ask_user_id":
    "Telegram 사용자 ID를 입력해주세요 (@userinfobot에서 확인할 수 있어요).\n> ",
  "runtime.wizard.user_id_invalid": "양의 정수를 입력해주세요 (> 0).\n",
  "runtime.wizard.ask_api_url":
    "OpenCode API URL을 입력해주세요 (선택사항).\nEnter를 누르면 기본값이 사용돼요: {defaultUrl}\n> ",
  "runtime.wizard.ask_server_username":
    "OpenCode 서버 사용자 이름을 입력해주세요 (선택사항).\nEnter를 누르면 기본값이 사용돼요: {defaultUsername}\n> ",
  "runtime.wizard.ask_server_password":
    "OpenCode 서버 비밀번호를 입력해주세요 (선택사항).\nEnter를 누르면 비워둬요.\n> ",
  "runtime.wizard.api_url_invalid": "유효한 URL(http/https)을 입력하거나 Enter를 눌러 기본값을 사용해주세요.\n",
  "runtime.wizard.start": "OpenCode Telegram Bot 설정.\n",
  "runtime.wizard.saved": "설정이 저장되었어요:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "아직 애플리케이션이 설정되지 않았어요. 설정 마법사를 시작해요...\n",
  "runtime.wizard.tty_required":
    "대화형 마법사에는 TTY 터미널이 필요해요. 대화형 셸에서 `opencode-telegram config`를 실행해주세요.",

  "rename.no_session": "⚠️ 활성 세션이 없어요. 먼저 세션을 만들거나 선택해주세요.",
  "rename.prompt": "📝 세션의 새 제목을 입력해주세요:\n\n현재: {title}",
  "rename.empty_title": "⚠️ 제목은 비워둘 수 없어요.",
  "rename.success": "✅ 세션 제목이 변경되었어요: {title}",
  "rename.error": "🔴 세션 제목 변경에 실패했어요.",
  "rename.cancelled": "❌ 제목 변경이 취소되었어요.",
  "rename.inactive_callback": "제목 변경 요청이 비활성 상태예요",
  "rename.inactive": "⚠️ 제목 변경 요청이 활성 상태가 아니에요. /rename을 다시 실행해주세요.",
  "rename.blocked.expected_name":
    "⚠️ 텍스트로 새 세션 이름을 입력하거나 제목 변경 메시지에서 취소를 눌러주세요.",
  "rename.blocked.command_not_allowed":
    "⚠️ 제목 변경이 대기 중일 때는 이 명령어를 사용할 수 없어요.",
  "rename.button.cancel": "❌ 취소",

  "task.prompt.schedule":
    "⏰ 자연어로 작업 일정을 보내주세요.\n\n예시:\n- 매 5분마다\n- 매일 오후 5시\n- 내일 낮 12시",
  "task.schedule_empty": "⚠️ 일정은 비워둘 수 없어요.",
  "task.parse.in_progress": "⏳ 일정을 파싱하는 중...",
  "task.parse_error":
    "🔴 일정 파싱에 실패했어요.\n\n{message}\n\n더 명확한 형태로 다시 보내주세요.",
  "task.schedule_preview":
    "✅ 일정이 파싱되었어요\n\n인식 결과: {summary}\n{cronLine}시간대: {timezone}\n유형: {kind}\n다음 실행: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 이제 일정에 따라 봇이 수행할 작업을 보내주세요.",
  "task.prompt_empty": "⚠️ 작업 내용은 비워둘 수 없어요.",
  "task.created":
    "✅ 예약 작업이 생성되었어요\n\n작업: {description}\n프로젝트: {project}\n모델: {model}\n일정: {schedule}\n{cronLine}다음 실행: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 일정 다시 입력",
  "task.button.cancel": "❌ 취소",
  "task.retry_schedule_callback": "일정을 다시 입력하는 중...",
  "task.cancel_callback": "취소하는 중...",
  "task.cancelled": "❌ 예약 작업 생성이 취소되었어요.",
  "task.inactive_callback": "이 예약 작업 흐름이 비활성 상태예요",
  "task.inactive": "⚠️ 예약 작업 생성이 활성 상태가 아니에요. /task를 다시 실행해주세요.",
  "task.blocked.expected_input":
    "⚠️ 먼저 일정 메시지에서 텍스트를 보내거나 버튼을 사용하여 예약 작업 설정을 완료해주세요.",
  "task.blocked.command_not_allowed":
    "⚠️ 예약 작업 생성이 활성화된 동안에는 이 명령어를 사용할 수 없어요.",
  "task.limit_reached": "⚠️ 작업 한도에 도달했어요 ({limit}). 기존 예약 작업을 먼저 삭제해주세요.",
  "task.schedule_too_frequent":
    "반복 일정이 너무 잦아요. 최소 허용 간격은 5분마다예요.",
  "task.kind.cron": "반복",
  "task.kind.once": "일회성",
  "task.run.success": "⏰ 예약 작업이 완료되었어요: {description}",
  "task.run.error": "🔴 예약 작업이 실패했어요: {description}\n\n오류: {error}",
  "task.run.error.interactive_question":
    "예약 작업이 대화형 질문을 요청하여 무인 모드로 계속할 수 없어요.",
  "task.run.error.interactive_permission":
    "예약 작업이 대화형 권한을 요청하여 무인 모드로 계속할 수 없어요.",

  "tasklist.empty": "📭 아직 예약 작업이 없어요.",
  "tasklist.select": "예약 작업을 선택해주세요:",
  "tasklist.details":
    "⏰ 예약 작업\n\n작업: {prompt}\n프로젝트: {project}\n일정: {schedule}\n{cronLine}시간대: {timezone}\n다음 실행: {nextRunAt}\n마지막 실행: {lastRunAt}\n실행 횟수: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 삭제",
  "tasklist.button.cancel": "❌ 취소",
  "tasklist.deleted_callback": "삭제되었어요",
  "tasklist.cancelled_callback": "취소되었어요",
  "tasklist.inactive_callback": "이 예약 작업 메뉴가 비활성 상태예요",
  "tasklist.load_error": "🔴 예약 작업을 불러오지 못했어요.",

  "commands.select": "OpenCode 명령어를 선택해주세요:",
  "commands.empty": "📭 이 프로젝트에서 사용할 수 있는 OpenCode 명령어가 없어요.",
  "commands.fetch_error": "🔴 OpenCode 명령어를 불러오지 못했어요.",
  "commands.no_description": "설명 없음",
  "commands.button.execute": "✅ 실행",
  "commands.button.cancel": "❌ 취소",
  "commands.confirm":
    "명령어 {command}의 실행을 확인해주세요. 인자와 함께 실행하려면 인자를 메시지로 보내주세요.",
  "commands.inactive_callback": "이 명령어 메뉴가 비활성 상태예요",
  "commands.cancelled_callback": "취소되었어요",
  "commands.execute_callback": "명령어 실행 중...",
  "commands.executing_prefix": "⚡ 명령어 실행:",
  "commands.arguments_empty": "⚠️ 인자는 비워둘 수 없어요. 텍스트를 보내거나 실행을 눌러주세요.",
  "commands.execute_error": "🔴 OpenCode 명령어 실행에 실패했어요.",
  "commands.select_page": "OpenCode 명령어를 선택해주세요 ({page} 페이지):",
  "commands.button.prev_page": "⬅️ 이전",
  "commands.button.next_page": "다음 ➡️",
  "commands.page_empty_callback": "이 페이지에 명령어가 없어요",
  "commands.page_load_error_callback": "이 페이지를 불러올 수 없어요. 다시 시도해주세요.",
  "commands.download.no_roots": "허용된 브라우저 루트가 설정되지 않았어요.",
  "commands.download.downloading": "파일 다운로드 중...",
  "commands.download.not_found": "파일을 찾을 수 없어요",
  "commands.download.not_file": "경로가 파일이 아니에요",
  "commands.download.file_too_large": "파일이 너무 커요",
  "commands.download.size": "크기",
  "commands.download.modified": "수정됨",
  "commands.download.error": "파일 다운로드에 실패했어요.",

  "skills.select": "OpenCode 스킬을 선택해주세요:",
  "skills.empty": "📭 이 프로젝트에서 사용할 수 있는 OpenCode 스킬이 없어요.",
  "skills.fetch_error": "🔴 OpenCode 스킬을 불러오지 못했어요.",
  "skills.no_description": "설명 없음",
  "skills.button.execute": "✅ 실행",
  "skills.button.cancel": "❌ 취소",
  "skills.confirm":
    "스킬 {skill}의 실행을 확인해주세요. 인자와 함께 실행하려면 인자를 메시지로 보내주세요.",
  "skills.inactive_callback": "이 스킬 메뉴가 비활성 상태예요",
  "skills.cancelled_callback": "취소되었어요",
  "skills.execute_callback": "스킬 사용 중...",
  "skills.executing_prefix": "⚡ 스킬 사용:",
  "skills.arguments_empty": "⚠️ 인자는 비워둘 수 없어요. 텍스트를 보내거나 실행을 눌러주세요.",
  "skills.select_page": "OpenCode 스킬을 선택해주세요 ({page} 페이지):",
  "skills.button.prev_page": "⬅️ 이전",
  "skills.button.next_page": "다음 ➡️",
  "skills.page_empty_callback": "이 페이지에 스킬이 없어요",
  "skills.page_load_error_callback": "이 페이지를 불러올 수 없어요. 다시 시도해주세요.",

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

  "cmd.description.rename": "현재 세션 제목 변경",

  "legacy.models.fetch_error": "🔴 모델 목록을 가져오지 못했어요. /status로 서버 상태를 확인해주세요.",
  "legacy.models.empty": "📋 사용 가능한 모델이 없어요. OpenCode에서 프로바이더를 설정해주세요.",
  "legacy.models.header": "📋 사용 가능한 모델:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ 사용 가능한 모델이 없어요\n",
  "legacy.models.env_hint": "💡 .env에서 모델을 사용하려면:\n",
  "legacy.models.error": "🔴 모델 목록을 불러오는 중 오류가 발생했어요.",

  "stt.recognizing": "🎤 오디오 인식 중...",
  "stt.recognized": "🎤 인식 결과:\n{text}",
  "stt.not_configured":
    "🎤 음성 인식이 설정되지 않았어요.\n\n활성화하려면 .env에 STT_API_URL과 STT_API_KEY를 설정해주세요.",
  "stt.error": "🔴 오디오 인식에 실패했어요: {error}",
  "stt.empty_result": "🎤 오디오 메시지에서 음성이 감지되지 않았어요.",

  "cmd.description.open": "디렉토리 탐색으로 프로젝트 추가",
  "worktree.branch_detached": "detached HEAD",
  "worktree.select_with_current": "워크트리를 선택해주세요:",
  "worktree.project_not_selected":
    "🏗 프로젝트가 선택되지 않았어요.\n\n먼저 /projects로 프로젝트를 선택해주세요.",
  "worktree.not_git_repo":
    "🌿 현재 프로젝트에서 Git 워크트리를 사용할 수 없어요. Git 저장소를 먼저 선택해주세요.",
  "worktree.not_git_repo_callback": "현재 프로젝트는 Git 저장소가 아니에요",
  "worktree.empty": "📭 현재 저장소에서 Git 워크트리를 찾을 수 없어요.",
  "worktree.fetch_error": "🔴 Git 워크트리를 불러오지 못했어요.",
  "worktree.page_empty_callback": "이 페이지에 워크트리가 없어요",
  "worktree.selection_missing_callback": "선택한 워크트리를 더 이상 사용할 수 없어요",
  "worktree.already_selected_callback": "이 워크트리는 이미 선택되어 있어요",
  "worktree.selected":
    "✅ 워크트리가 선택되었어요: {worktree}\n\n📋 세션이 초기화되었어요. /sessions 또는 /new로 계속해주세요.",
  "worktree.select_error": "🔴 워크트리 선택에 실패했어요.",
  "open.back": "⬆️ 상위",
  "open.roots": "📋 루트로 돌아가기",
  "open.prev_page": "⬅️ 이전",
  "open.next_page": "다음 ➡️",
  "open.select_current": "✅ 이 폴더 선택",
  "open.select_root": "📂 탐색할 루트 디렉토리를 선택해주세요:",
  "open.access_denied": "⛔ 접근 거부: 경로가 허용된 루트 외부예요",
  "open.scan_error": "🔴 디렉토리를 탐색할 수 없어요: {error}",
  "open.open_error": "🔴 디렉토리 브라우저를 열지 못했어요.",
  "open.selected": "✅ 프로젝트가 추가되었어요: {project}\n\n📋 /sessions 또는 /new로 작업을 시작해주세요.",
  "open.select_error": "🔴 프로젝트 추가에 실패했어요.",
  "open.no_subfolders": "📭 하위 폴더가 없어요",
  "open.subfolder_count": "{count}개 하위 폴더",
  "open.subfolders_count": "{count}개 하위 폴더",
  "ls.access_denied": "⛔ 접근 거부: 경로가 현재 프로젝트 외부예요",
  "ls.scan_error": "🔴 디렉토리 목록을 불러올 수 없어요",
  "ls.header": "디렉토리 목록",
  "ls.total": "총 {count}개 항목",
  "ls.file.header": "파일 상세 정보",
  "ls.file.download": "📥 다운로드",
  "ls.file.back": "⬅️ 뒤로",
};
