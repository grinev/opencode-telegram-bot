import type { I18nDictionary } from "./en.js";

/**
 * Korean localization for OpenCode Telegram Bot.
 *
 * Keep upstream emoji and technical terms where they help recognition.
 * Prefer natural Korean wording over literal translation.
 * Keep this dictionary complete to avoid falling back to another locale.
 */
export const ko: I18nDictionary = {
  "cmd.description.status": "서버 및 세션 상태",
  "cmd.description.new": "새 세션 만들기",
  "cmd.description.stop": "현재 작업 중지",
  "cmd.description.detach": "현재 세션에서 분리",
  "cmd.description.sessions": "세션 목록 보기",
  "cmd.description.messages": "세션 메시지 탐색",
  "cmd.description.settings": "봇 설정 변경",
  "cmd.description.projects": "프로젝트 목록 보기",
  "cmd.description.worktree": "git 워크트리 전환",
  "cmd.description.task": "예약 작업 만들기",
  "cmd.description.tasklist": "예약 작업 목록 보기",
  "cmd.description.commands": "사용자 지정 명령어",
  "cmd.description.skills": "스킬 카탈로그",
  "cmd.description.mcps": "MCP 서버",
  "cmd.description.opencode_start": "OpenCode 서버 시작",
  "cmd.description.opencode_stop": "OpenCode 서버 중지",
  "cmd.description.ls": "디렉터리 내용 보기",
  "cmd.description.help": "도움말",

  "callback.unknown_command": "알 수 없는 명령어",
  "callback.processing_error": "처리 오류",

  "error.load_agents": "❌ 에이전트 목록을 불러오지 못했습니다",
  "error.load_models": "❌ 모델 목록을 불러오지 못했습니다",
  "error.load_variants": "❌ 변형 목록을 불러오지 못했습니다",
  "error.context_button": "❌ 컨텍스트 버튼을 처리하지 못했습니다",
  "error.generic": "🔴 문제가 발생했습니다.",

  "interaction.blocked.expired": "⚠️ 이 상호작용은 만료되었습니다. 다시 시작해 주세요.",
  "interaction.blocked.expected_callback":
    "⚠️ 이 단계에서는 인라인 버튼을 사용하거나 취소를 눌러 주세요.",
  "interaction.blocked.expected_text": "⚠️ 이 단계에서는 텍스트 메시지를 보내 주세요.",
  "interaction.blocked.expected_command": "⚠️ 이 단계에서는 명령어를 보내 주세요.",
  "interaction.blocked.command_not_allowed":
    "⚠️ 현재 단계에서는 이 명령어를 사용할 수 없습니다.",
  "interaction.blocked.finish_current":
    "⚠️ 먼저 현재 상호작용을 마친(답변 또는 취소) 뒤에 다른 메뉴를 열어 주세요.",

  "inline.blocked.expected_choice": "⚠️ 인라인 버튼으로 옵션을 선택하거나 취소를 눌러 주세요.",
  "inline.blocked.command_not_allowed":
    "⚠️ 인라인 메뉴가 활성화된 동안에는 이 명령어를 사용할 수 없습니다.",

  "question.blocked.expected_answer":
    "⚠️ 버튼, 직접 입력, 또는 취소로 현재 질문에 답해 주세요.",
  "question.blocked.command_not_allowed":
    "⚠️ 현재 질문 흐름이 끝날 때까지는 이 명령어를 사용할 수 없습니다.",

  "inline.button.cancel": "❌ 취소",
  "inline.button.close": "❌ 닫기",
  "inline.inactive_callback": "이 메뉴는 비활성 상태입니다",

  "common.cancelled": "취소됨",
  "common.unknown": "알 수 없음",
  "common.unknown_error": "알 수 없는 오류",

  "start.welcome":
    "👋 OpenCode Telegram Bot에 오신 것을 환영합니다!\n\n사용 가능한 명령어:\n/projects — 프로젝트 선택\n/sessions — 세션 목록\n/new — 새 세션\n/commands — 사용자 지정 명령어\n/skills — 스킬 카탈로그\n/task — 예약 작업\n/tasklist — 예약 작업 목록\n/status — 상태\n/help — 도움말\n\n아래 버튼으로 에이전트, 모델, 변형을 선택하세요.",
  "help.keyboard_hint":
    "💡 아래 키보드 버튼으로 에이전트, 모델, 변형 및 컨텍스트 작업을 사용할 수 있습니다.",
  "help.text":
    "📖 **도움말**\n\n/status - 서버 상태 확인\n/sessions - 세션 목록\n/new - 새 세션 만들기\n/help - 도움말",

  "bot.thinking": "💭 생각하는 중...",
  "progress.compact.activity": "{header}\n{activity}",
  "progress.compact.working_header": "⏳ 작업 중",
  "progress.compact.finished_header": "✅ 작업 완료",
  "progress.compact.thinking": "💭 생각하는 중...",
  "progress.compact.responding": "✍️ 답변 작성 중...",
  "progress.compact.waiting_question": "❓ 답변을 기다리는 중...",
  "progress.compact.waiting_permission": "🔐 권한 승인을 기다리는 중...",
  "progress.compact.retrying": "🔁 다시 시도하는 중...",
  "progress.compact.task": "🤖 작업 실행 중",
  "progress.compact.done": "{header}\n도구 호출: {tools} · 변경된 파일: {files}",
  "bot.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "bot.creating_session": "🔄 새 세션을 만드는 중...",
  "bot.create_session_error":
    "🔴 세션 생성에 실패했습니다. /new를 다시 시도하거나 /status로 서버 상태를 확인해 주세요.",
  "bot.session_created": "✅ 세션이 생성되었습니다: {title}",
  "bot.session_busy":
    "⏳ 에이전트가 이미 작업을 실행 중입니다. 완료될 때까지 기다리거나 /abort로 현재 실행을 중단하세요.",
  "bot.session_reset_project_mismatch":
    "⚠️ 활성 세션이 선택한 프로젝트와 일치하지 않아 초기화되었습니다. /sessions에서 세션을 선택하거나 /new로 새 세션을 만들어 주세요.",
  "bot.prompt_send_error": "OpenCode에 요청을 보내지 못했습니다.",
  "bot.session_error": "🔴 OpenCode 오류가 발생했습니다: {message}",
  "bot.session_retry":
    "🔁 {message}\n\n재시도할 때마다 동일한 오류가 반복됩니다. /abort로 중단하세요.",
  "bot.external_user_input": "외부 사용자 입력",
  "background.session_fallback": "세션 {id}",
  "background.assistant_response": "🔔 백그라운드 세션에서 답변이 도착했습니다: {session}",
  "background.question_asked": "❓ 백그라운드 세션에서 답변이 필요합니다: {session}",
  "background.permission_asked": "🔐 백그라운드 세션에서 권한을 요청했습니다: {session}",
  "background.open_session_button": "세션 열기",
  "bot.unknown_command": "⚠️ 알 수 없는 명령어입니다: {command}. /help로 사용 가능한 명령어를 확인하세요.",
  "bot.photo_downloading": "⏳ 사진을 다운로드하는 중...",
  "bot.photo_too_large": "⚠️ 사진이 너무 큽니다 (최대 {maxSizeMb}MB)",
  "bot.photo_model_no_image": "⚠️ 현재 모델은 이미지 입력을 지원하지 않습니다. 텍스트만 전송합니다.",
  "bot.photo_download_error": "🔴 사진 다운로드에 실패했습니다",
  "bot.photo_no_caption": "💡 팁: 이 사진으로 무엇을 할지 설명하는 캡션을 추가해 보세요.",
  "bot.file_downloading": "⏳ 파일을 다운로드하는 중...",
  "bot.files_downloading": "⏳ 파일들을 다운로드하는 중...",
  "bot.file_too_large": "⚠️ 파일이 너무 큽니다 (최대 {maxSizeMb}MB)",
  "bot.file_download_error": "🔴 파일 다운로드에 실패했습니다",
  "bot.file_type_unsupported":
    "⚠️ 지원되지 않는 파일 형식입니다. 이미지, 문서(PDF, DOCX, PPTX) 또는 텍스트/코드 파일을 보내 주세요.",
  "bot.media_group_not_processed":
    "⚠️ 이 앨범의 일부 파일은 처리할 수 없습니다. OpenCode에 아무것도 전송되지 않았습니다.",
  "bot.media_group_download_error":
    "🔴 파일 중 하나를 다운로드하지 못했습니다. OpenCode에 아무것도 전송되지 않았습니다.",
  "bot.model_no_pdf": "⚠️ 현재 모델은 PDF 입력을 지원하지 않습니다. 텍스트만 전송합니다.",
  "bot.document_extraction_error": "🔴 문서 텍스트 추출에 실패했습니다.",
  "bot.text_file_too_large": "⚠️ 텍스트 파일이 너무 큽니다 (최대 {maxSizeKb}KB)",

  "status.header_running": "🟢 OpenCode 서버 실행 중",
  "status.health.healthy": "정상",
  "status.health.unhealthy": "비정상",
  "status.line.health": "상태: {health}",
  "status.line.version": "버전: {version}",
  "status.line.managed_yes": "봇이 시작함: 예",
  "status.line.managed_no": "봇이 시작함: 아니요",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "가동 시간: {seconds}초",
  "status.line.mode": "에이전트: {mode}",
  "status.line.model": "모델: {model}",
  "status.line.tts": "음성 답변: {tts}",
  "status.tts.off": "꺼짐",
  "status.tts.all": "전체",
  "status.tts.auto": "자동",
  "status.agent_not_set": "설정 안 됨",
  "status.project_selected": "프로젝트: {project}",
  "status.worktree_selected": "워크트리: {worktree}",
  "status.project_not_selected": "프로젝트: 선택 안 됨",
  "status.project_hint": "/projects로 프로젝트를 선택해 주세요",
  "status.session_selected": "현재 세션: {title}",
  "status.session_not_selected": "현재 세션: 선택 안 됨",
  "status.session_hint": "/sessions에서 선택하거나 /new로 새로 만들어 주세요",
  "status.server_unavailable":
    "🔴 OpenCode 서버에 연결할 수 없습니다\n\n/opencode_start로 서버를 시작해 주세요.",

  "tts.off": "🔇 음성 답변이 비활성화되었습니다.",
  "tts.all": "🔊 모든 메시지에 음성 답변이 활성화되었습니다.",
  "tts.auto": "🎤 음성/오디오 메시지에만 음성 답변이 활성화되었습니다.",
  "tts.not_configured":
    "⚠️ 음성 답변을 사용할 수 없습니다. 먼저 `TTS_API_URL`과 `TTS_API_KEY`를 설정해 주세요.",
  "tts.failed": "⚠️ 음성 답변 생성에 실패했습니다.",

  "settings.menu.title": "⚙️ 봇 설정\n항목을 탭하여 값을 전환하세요:",
  "settings.compact_output.label": "간결 출력 모드",
  "settings.thinking_content.label": "생각 내용",
  "settings.response_streaming.label": "응답 스트리밍",
  "settings.response_streaming.edit": "편집",
  "settings.response_streaming.draft": "초안 (실험적)",
  "settings.diff_files.label": "Diff 파일",
  "settings.assistant_footer.label": "어시스턴트 푸터",
  "settings.tts.label": "음성 답변",
  "settings.prompt_queue.label": "메시지 대기열",
  "settings.value.on": "켜기",
  "settings.value.off": "끄기",
  "settings.saved": "✅ 설정이 저장되었습니다.",

  "projects.empty":
    "📭 프로젝트가 없습니다.\n\nOpenCode에서 디렉터리를 열고 세션을 하나 이상 만들면 여기에 표시됩니다.",
  "projects.select": "프로젝트를 선택하세요:",
  "projects.select_with_current": "프로젝트를 선택하세요:\n\n현재: 🏗 {project}",
  "projects.page_indicator": "{current}/{total} 페이지",
  "projects.prev_page": "⬅️ 이전",
  "projects.next_page": "다음 ➡️",
  "projects.fetch_error":
    "🔴 OpenCode 서버에 연결할 수 없거나 프로젝트를 불러오는 중 오류가 발생했습니다.",
  "projects.page_load_error": "이 페이지를 불러올 수 없습니다. 다시 시도해 주세요.",
  "projects.selected":
    "✅ 프로젝트 선택됨: {project}\n\n📋 세션이 초기화되었습니다. 이 프로젝트에서 /sessions 또는 /new를 사용해 주세요.",
  "projects.select_error": "🔴 프로젝트 선택에 실패했습니다.",

  "sessions.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "sessions.empty": "📭 세션이 없습니다.\n\n/new로 새 세션을 만들어 주세요.",
  "sessions.select": "세션을 선택하세요:",
  "sessions.select_page": "세션을 선택하세요 ({page} 페이지):",
  "sessions.fetch_error":
    "🔴 OpenCode 서버에 연결할 수 없거나 세션을 불러오는 중 오류가 발생했습니다.",
  "sessions.select_project_first": "🔴 프로젝트가 선택되지 않았습니다. /projects를 사용해 주세요.",
  "sessions.page_empty_callback": "이 페이지에는 세션이 없습니다",
  "sessions.page_load_error_callback": "이 페이지를 불러올 수 없습니다. 다시 시도해 주세요.",
  "sessions.button.prev_page": "⬅️ 이전",
  "sessions.button.next_page": "다음 ➡️",
  "sessions.loading_context": "⏳ 컨텍스트와 최근 메시지를 불러오는 중...",
  "sessions.selected": "✅ 세션 선택됨: {title}",
  "sessions.select_error": "🔴 세션 선택에 실패했습니다.",
  "sessions.preview.empty": "최근 메시지가 없습니다.",
  "sessions.preview.title": "최근 메시지:",
  "sessions.preview.you": "나:",
  "sessions.preview.agent": "에이전트:",

  "messages.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "messages.session_not_selected":
    "💬 세션이 선택되지 않았습니다.\n\n먼저 /sessions에서 세션을 선택하거나 /new로 만들어 주세요.",
  "messages.session_project_mismatch":
    "⚠️ 선택한 세션이 현재 프로젝트와 일치하지 않습니다. /sessions에서 세션을 다시 선택해 주세요.",
  "messages.empty": "📭 현재 세션에 사용자 메시지가 없습니다.",
  "messages.select": "메시지를 선택하세요:",
  "messages.select_page": "메시지를 선택하세요 ({page} 페이지):",
  "messages.fetch_error":
    "🔴 OpenCode 서버에 연결할 수 없거나 메시지를 불러오는 중 오류가 발생했습니다.",
  "messages.inactive_callback": "이 메시지 메뉴는 비활성 상태입니다",
  "messages.page_empty_callback": "이 페이지에는 메시지가 없습니다",
  "messages.button.prev_page": "⬅️ 이전",
  "messages.button.next_page": "다음 ➡️",
  "messages.button.revert": "↩️ 되돌리기",
  "messages.button.fork": "🔀 포크",
  "messages.button.back": "⬅️ 뒤로",
  "messages.button.cancel": "❌ 취소",
  "messages.revert_success": "✅ 이 메시지로 되돌렸습니다:\n\n{text}",
  "messages.revert_error": "❌ 메시지 되돌리기에 실패했습니다. 다시 시도해 주세요.",
  "messages.fork_success": "🔀 이 메시지에서 포크를 만들었습니다:\n\n{text}",
  "messages.fork_error": "❌ 포크 생성에 실패했습니다. 다시 시도해 주세요.",

  "attach.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "attach.session_not_selected":
    "💬 세션이 선택되지 않았습니다.\n\n먼저 /sessions에서 세션을 선택해 주세요.",
  "attach.session_project_mismatch":
    "⚠️ 선택한 세션이 현재 프로젝트와 일치하지 않습니다. /sessions에서 세션을 다시 선택해 주세요.",
  "attach.connected": "✅ 세션에 연결됨: {title}",
  "attach.already_connected": "ℹ️ 이미 세션에 연결되어 있습니다: {title}",
  "attach.status.idle_message": "상태: 대기 중. 새 이벤트를 기다리고 있습니다.",
  "attach.status.busy_message": "상태: 작업 중. 새 요청은 일시적으로 차단됩니다.",
  "attach.restored_question": "이 세션의 미응답 질문을 복구했습니다.",
  "attach.restored_permissions": "대기 중이던 권한 요청을 복구했습니다: {count}건.",
  "attach.disconnect_hint": "연결을 해제하려면 다른 세션이나 프로젝트로 전환하세요.",
  "attach.error": "🔴 현재 세션에 연결하지 못했습니다.",

  "detach.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "detach.no_active_session": "ℹ️ 봇은 이미 어떤 세션에도 연결되어 있지 않습니다.",
  "detach.success":
    "✅ 세션에서 분리됨: {title}\n\nOpenCode 세션은 중지되지 않았습니다. 아직 실행 중이라면 별도로 계속 진행됩니다. 나중에 확인하려면 /sessions에서 다시 선택하세요.",
  "detach.error": "🔴 현재 세션에서 분리하지 못했습니다.",

  "new.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "new.created": "✅ 새 세션이 생성되었습니다: {title}",
  "new.create_error":
    "🔴 OpenCode 서버에 연결할 수 없거나 세션을 만드는 중 오류가 발생했습니다.",

  "stop.no_active_session":
    "🛑 에이전트가 시작되지 않았습니다\n\n/new로 세션을 만들거나 /sessions에서 선택해 주세요.",
  "stop.in_progress":
    "🛑 이벤트 스트림이 중지되었으며 중단 신호를 보내는 중...\n\n에이전트가 멈출 때까지 기다려 주세요.",
  "stop.warn_unconfirmed":
    "⚠️ 이벤트 스트림은 중지되었지만 서버가 중단을 확인하지 않았습니다.\n\n/status를 확인하고 몇 초 후 /abort를 다시 시도해 주세요.",
  "stop.warn_maybe_finished": "⚠️ 이벤트 스트림이 중지되었지만 에이전트가 이미 작업을 마쳤을 수도 있습니다.",
  "stop.success": "✅ 에이전트 작업이 중단되었습니다. 이 실행의 추가 메시지는 더 이상 전송되지 않습니다.",
  "stop.warn_still_busy":
    "⚠️ 신호를 보냈지만 에이전트가 아직 작업 중입니다.\n\n이벤트 스트림이 이미 비활성화되어 중간 메시지는 전송되지 않습니다.",
  "stop.warn_timeout":
    "⚠️ 중단 요청 시간이 초과되었습니다.\n\n이벤트 스트림은 이미 비활성화되어 있습니다. 몇 초 후 /abort를 다시 시도해 주세요.",
  "stop.warn_local_only": "⚠️ 로컬에서는 이벤트 스트림이 중지되었지만 서버 측 중단에는 실패했습니다.",
  "stop.error": "🔴 작업 중지에 실패했습니다.\n\n이벤트 스트림은 중지되었습니다. /abort를 다시 시도해 주세요.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode 서버가 이미 실행 중입니다\n\nPID: {pid}\n가동 시간: {seconds}초",
  "opencode_start.already_running_external":
    "✅ OpenCode 서버가 외부 프로세스로 이미 실행 중입니다\n\n버전: {version}\n\n이 서버는 봇이 시작한 것이 아니므로 /opencode-stop으로 중지할 수 없습니다.",
  "opencode_start.already_running": "✅ OpenCode 서버가 이미 실행 중입니다\n\n버전: {version}",
  "opencode_start.remote_configured": "⚠️ /opencode_start는 로컬 OpenCode 서버에서만 동작합니다.",
  "opencode_start.starting": "🔄 OpenCode 서버를 시작하는 중...",
  "opencode_start.start_error":
    "🔴 OpenCode 서버 시작에 실패했습니다\n\n오류: {error}\n\nOpenCode CLI가 설치되어 있고 PATH에서 사용 가능한지 확인해 주세요:\nopencode --version\nnpm install -g @opencode-ai/cli",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode 서버가 시작되었지만 응답하지 않습니다\n\nPID: {pid}\n\n서버가 아직 시작 중일 수 있습니다. 몇 초 후 /status를 시도해 주세요.",
  "opencode_start.success":
    "✅ OpenCode 서버가 성공적으로 시작되었습니다\n\nPID: {pid}\n버전: {version}",
  "opencode_start.error":
    "🔴 서버 시작 중 오류가 발생했습니다.\n\n자세한 내용은 애플리케이션 로그를 확인해 주세요.",
  "opencode_stop.external_running":
    "⚠️ OpenCode 서버가 외부 프로세스로 실행 중입니다\n\n이 서버는 /opencode-start로 시작된 것이 아닙니다.\n직접 중지하거나 /status로 상태를 확인해 주세요.",
  "opencode_stop.remote_configured": "⚠️ /opencode_stop은 로컬 OpenCode 서버에서만 동작합니다.",
  "opencode_stop.not_running": "⚠️ OpenCode 서버가 실행 중이지 않습니다",
  "opencode_stop.pid_not_found":
    "⚠️ OpenCode 서버가 포트 {port}에서 응답하고 있지만 중지할 로컬 프로세스를 찾을 수 없습니다.",
  "opencode_stop.stopping": "🛑 OpenCode 서버를 중지하는 중...\n\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 OpenCode 서버 중지에 실패했습니다\n\n오류: {error}",
  "opencode_stop.still_running": "중지 요청 후에도 서버가 응답하고 있습니다.",
  "opencode_stop.success": "✅ OpenCode 서버가 성공적으로 중지되었습니다",
  "opencode_stop.error":
    "🔴 서버 중지 중 오류가 발생했습니다.\n\n자세한 내용은 애플리케이션 로그를 확인해 주세요.",

  "agent.changed_message": "✅ 에이전트가 변경되었습니다: {name}",
  "agent.change_error_callback": "에이전트 변경 실패",
  "agent.menu.current": "현재 에이전트: {name}\n\n에이전트를 선택하세요:",
  "agent.menu.select": "에이전트를 선택하세요:",
  "agent.menu.empty": "⚠️ 사용 가능한 에이전트가 없습니다",
  "agent.menu.error": "🔴 에이전트 목록을 가져오지 못했습니다",

  "model.changed_message": "✅ 모델이 변경되었습니다: {name}",
  "model.change_error_callback": "모델 변경 실패",
  "model.menu.empty": "⚠️ 사용 가능한 모델이 없습니다",
  "model.menu.select": "모델을 선택하세요:",
  "model.menu.current": "현재 모델: {name}\n\n모델을 선택하세요:",
  "model.menu.favorites_title": "⭐ 즐겨찾기 (OpenCode CLI에서 모델을 즐겨찾기에 추가하세요)",
  "model.menu.favorites_empty": "— 비어 있음.",
  "model.menu.recent_title": "🕘 최근 사용",
  "model.menu.recent_empty": "— 비어 있음.",
  "model.menu.favorites_hint":
    "ℹ️ OpenCode CLI에서 모델을 즐겨찾기에 추가하면 목록 상단에 고정됩니다.",
  "model.menu.error": "🔴 모델 목록을 가져오지 못했습니다",
  "model.search.button": "🔍 검색",
  "model.search.prompt": "🔍 검색할 모델 이름을 입력하세요:",
  "model.search.results_title": '"{query}" 검색 결과:',
  "model.search.no_results": '"{query}"에 대한 모델을 찾을 수 없습니다',
  "model.search.search_again": "↩ 다시 검색",
  "model.search.error": "검색에 실패했습니다",
  "model.button.back": "⬅️ 뒤로",
  "model.providers.button": "🗂 프로바이더",
  "model.providers.title": "목록에서 프로바이더를 선택하세요:",
  "model.providers.empty": "⚠️ 연결된 프로바이더가 없습니다",
  "model.providers.error": "프로바이더 목록을 가져오지 못했습니다",
  "model.providers.page_indicator": "{current}/{total} 페이지",
  "model.providers.prev_page": "⬅️ 이전",
  "model.providers.next_page": "다음 ➡️",
  "model.provider_models.title": "{provider} — 모델을 선택하세요:",
  "model.provider_models.empty": "⚠️ {provider}에서 사용 가능한 모델이 없습니다",
  "model.provider_models.page_indicator": "{current}/{total} 페이지",

  "variant.model_not_selected_callback": "오류: 모델이 선택되지 않았습니다",
  "variant.changed_message": "✅ 변형이 변경되었습니다: {name}",
  "variant.change_error_callback": "변형 변경 실패",
  "variant.select_model_first": "⚠️ 먼저 모델을 선택해 주세요",
  "variant.menu.empty": "⚠️ 사용 가능한 변형이 없습니다",
  "variant.menu.current": "현재 변형: {name}\n\n변형을 선택하세요:",
  "variant.menu.error": "🔴 변형 목록을 가져오지 못했습니다",

  "context.button.confirm": "✅ 예, 컨텍스트를 압축합니다",
  "context.no_active_session": "⚠️ 활성 세션이 없습니다. /new로 세션을 만들어 주세요",
  "context.confirm_text":
    '📊 세션 "{title}"의 컨텍스트 압축\n\n기록에서 오래된 메시지를 제거하여 컨텍스트 사용량을 줄입니다. 현재 작업은 중단되지 않습니다.\n\n계속하시겠습니까?',
  "context.callback_compacting": "컨텍스트를 압축하는 중...",
  "context.progress": "⏳ 컨텍스트를 압축하는 중...",
  "context.error": "❌ 컨텍스트 압축에 실패했습니다",
  "context.success": "✅ 컨텍스트 압축이 완료되었습니다",

  "permission.inactive_callback": "권한 요청이 비활성 상태입니다",
  "permission.processing_error_callback": "처리 오류",
  "permission.no_active_request_callback": "오류: 활성 요청이 없습니다",
  "permission.reply.once": "한 번 허용됨",
  "permission.reply.always": "항상 허용됨",
  "permission.reply.reject": "거부됨",
  "permission.send_reply_error": "❌ 권한 응답 전송에 실패했습니다",
  "permission.blocked.expected_reply":
    "⚠️ 먼저 위의 버튼으로 권한 요청에 답해 주세요.",
  "permission.blocked.command_not_allowed":
    "⚠️ 권한 요청에 답하기 전까지는 이 명령어를 사용할 수 없습니다.",
  "permission.header": "{emoji} 권한 요청: {name}\n\n",
  "permission.grouped_count": "\n⚠️ 동일한 요청 {count}건이 대기 중입니다 — 답변은 모든 요청에 적용됩니다.\n",
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
  "permission.name.list": "디렉터리 조회",
  "permission.name.task": "작업",
  "permission.name.lsp": "LSP",
  "permission.name.external_directory": "외부 디렉터리",

  "question.inactive_callback": "설문이 비활성 상태입니다",
  "question.processing_error_callback": "처리 오류",
  "question.select_one_required_callback": "옵션을 하나 이상 선택해 주세요",
  "question.enter_custom_callback": "직접 입력한 답변을 메시지로 보내 주세요",
  "question.cancelled": "❌ 설문이 취소되었습니다",
  "question.answer_already_received": "답변이 이미 접수되었습니다. 잠시만 기다려 주세요...",
  "question.completed_no_answers": "✅ 설문 완료 (답변 없음)",
  "question.no_active_project": "❌ 활성 프로젝트가 없습니다",
  "question.no_active_request": "❌ 활성 요청이 없습니다",
  "question.send_answers_error": "❌ 에이전트에 답변을 보내지 못했습니다",
  "question.multi_hint": "\n(여러 옵션을 선택할 수 있습니다)",
  "question.button.submit": "✅ 완료",
  "question.button.custom": "🔤 직접 입력",
  "question.button.cancel": "❌ 취소",
  "question.use_custom_button_first":
    '⚠️ 텍스트를 보내려면 먼저 현재 질문에서 "직접 입력" 버튼을 탭해 주세요.',
  "question.summary.title": "✅ 설문이 완료되었습니다!\n\n",
  "question.summary.question": "질문 {index}:\n{question}\n\n",
  "question.summary.answer": "답변:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} 에이전트",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 기본값",
  "keyboard.queued_prompt": "❌ {index}. {text}",
  "queue.added": "📥 대기열에 추가되었습니다 ({count}/{max}). 현재 작업이 끝나면 전송됩니다.",
  "queue.full": "⚠️ 대기열이 가득 찼습니다 ({max}). 메시지를 삭제하거나 현재 작업이 끝날 때까지 기다려 주세요.",
  "queue.removed": "🗑 대기열에서 메시지를 삭제했습니다.",
  "queue.not_found": "이 메시지는 더 이상 대기열에 없습니다.",
  "queue.disabled_hint": "메시지 대기열은 /settings에서 활성화할 수 있습니다.",
  "keyboard.updated": "⌨️ 키보드가 업데이트되었습니다",

  "pinned.default_session_title": "새 세션",
  "pinned.unknown": "알 수 없음",
  "pinned.line.project": "프로젝트: {project}",
  "pinned.line.worktree": "워크트리: {worktree}",
  "pinned.line.model": "모델: {model}",
  "pinned.line.attach": "추적: {status}",
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
  "subagent.completed": "완료됨",
  "subagent.failed": "작업 실패",
  "subagent.status.pending": "대기 중",
  "subagent.status.running": "실행 중",
  "subagent.status.completed": "완료됨",
  "subagent.status.error": "오류",
  "pinned.files.title": "파일 ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... 외 {count}개",

  "tool.todo.overflow": "*({count}개 작업 더 보기)*",
  "tool.file_header.write":
    "파일 쓰기 경로: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "파일 편집 경로: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "텔레그램 봇 토큰을 입력하세요 (@BotFather에서 발급).\n> ",
  "runtime.wizard.ask_language":
    "인터페이스 언어를 선택하세요.\n목록의 번호 또는 로케일 코드를 입력하세요.\nEnter를 누르면 기본 언어({defaultLocale})가 유지됩니다.\n{options}\n> ",
  "runtime.wizard.language_invalid":
    "목록의 언어 번호 또는 지원되는 로케일 코드를 입력하세요.\n",
  "runtime.wizard.language_selected": "선택한 언어: {language}\n",
  "runtime.wizard.token_required": "토큰은 필수입니다. 다시 시도해 주세요.\n",
  "runtime.wizard.token_invalid":
    "토큰이 잘못된 것 같습니다 (<id>:<secret> 형식이어야 합니다). 다시 시도해 주세요.\n",
  "runtime.wizard.ask_user_id":
    "텔레그램 사용자 ID를 입력하세요 (@userinfobot에서 확인할 수 있습니다).\n> ",
  "runtime.wizard.user_id_invalid": "양의 정수를 입력하세요 (> 0).\n",
  "runtime.wizard.ask_api_url":
    "OpenCode API URL을 입력하세요 (선택 사항).\nEnter를 누르면 기본값({defaultUrl})이 사용됩니다.\n> ",
  "runtime.wizard.ask_server_username":
    "OpenCode 서버 사용자 이름을 입력하세요 (선택 사항).\nEnter를 누르면 기본값({defaultUsername})이 사용됩니다.\n> ",
  "runtime.wizard.ask_server_password":
    "OpenCode 서버 비밀번호를 입력하세요 (선택 사항).\nEnter를 누르면 비워 둡니다.\n> ",
  "runtime.wizard.api_url_invalid":
    "유효한 URL(http/https)을 입력하거나 Enter를 눌러 기본값을 사용하세요.\n",
  "runtime.wizard.start": "OpenCode Telegram Bot 설정을 시작합니다.\n",
  "runtime.wizard.saved": "설정이 저장되었습니다:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "아직 구성되지 않았습니다. 설정 마법사를 시작합니다...\n",
  "runtime.wizard.tty_required":
    "대화형 마법사에는 TTY 터미널이 필요합니다. 대화형 셸에서 `opencode-telegram config`를 실행해 주세요.",

  "rename.no_session": "⚠️ 활성 세션이 없습니다. 먼저 세션을 만들거나 선택해 주세요.",
  "rename.prompt": "📝 세션의 새 제목을 입력하세요:\n\n현재: {title}",
  "rename.empty_title": "⚠️ 제목은 비워 둘 수 없습니다.",
  "rename.success": "✅ 세션 이름이 변경되었습니다: {title}",
  "rename.error": "🔴 세션 이름 변경에 실패했습니다.",
  "rename.cancelled": "❌ 이름 변경이 취소되었습니다.",
  "rename.inactive_callback": "이름 변경 요청이 비활성 상태입니다",
  "rename.inactive": "⚠️ 이름 변경 요청이 활성 상태가 아닙니다. /rename을 다시 실행해 주세요.",
  "rename.blocked.expected_name":
    "⚠️ 새 세션 이름을 텍스트로 입력하거나 이름 변경 메시지에서 취소를 탭해 주세요.",
  "rename.blocked.command_not_allowed":
    "⚠️ 새 이름을 기다리는 동안에는 이 명령어를 사용할 수 없습니다.",
  "rename.button.cancel": "❌ 취소",

  "task.prompt.schedule":
    "⏰ 작업 일정을 자연어로 입력하세요.\n\n예시:\n- 5분마다\n- 매일 17:00\n- 내일 12:00",
  "task.schedule_empty": "⚠️ 일정은 비워 둘 수 없습니다.",
  "task.parse.in_progress": "⏳ 일정을 해석하는 중...",
  "task.parse_error":
    "🔴 일정을 해석하지 못했습니다.\n\n{message}\n\n더 명확한 형태로 일정을 다시 보내 주세요.",
  "task.schedule_preview":
    "✅ 일정이 해석되었습니다\n\n이렇게 이해했습니다: {summary}\n{cronLine}시간대: {timezone}\n유형: {kind}\n다음 실행: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 이제 봇이 정해진 일정에 수행할 작업 내용을 보내주세요.",
  "task.prompt_empty": "⚠️ 작업 내용은 비워 둘 수 없습니다.",
  "task.created":
    "✅ 예약 작업이 생성되었습니다\n\n작업: {description}\n프로젝트: {project}\n에이전트: {agent}\n모델: {model}\n일정: {schedule}\n{cronLine}다음 실행: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 일정 다시 입력",
  "task.button.cancel": "❌ 취소",
  "task.retry_schedule_callback": "일정을 다시 입력하는 중...",
  "task.inactive_callback": "이 예약 작업 흐름은 비활성 상태입니다",
  "task.inactive": "⚠️ 예약 작업 생성이 활성 상태가 아닙니다. /task를 다시 실행해 주세요.",
  "task.blocked.expected_input":
    "⚠️ 텍스트를 보내거나 일정 메시지의 버튼을 사용하여 현재 예약 작업 설정을 먼저 마쳐 주세요.",
  "task.blocked.command_not_allowed":
    "⚠️ 예약 작업 생성이 진행 중인 동안에는 이 명령어를 사용할 수 없습니다.",
  "task.limit_reached": "⚠️ 작업 개수 한도에 도달했습니다 ({limit}). 먼저 기존 예약 작업을 삭제해 주세요.",
  "task.schedule_too_frequent":
    "반복 일정이 너무 잦습니다. 허용되는 최소 간격은 5분마다 한 번입니다.",
  "task.kind.cron": "반복",
  "task.kind.once": "1회성",
  "task.run.success": "⏰ 예약 작업 완료: {description}",
  "task.run.error": "🔴 예약 작업 실패: {description}\n\n오류: {error}",
  "task.run.error.interactive_question":
    "예약 작업이 대화형 질문을 요청하여 무인 실행을 계속할 수 없습니다.",
  "task.run.error.interactive_permission":
    "예약 작업이 대화형 권한 승인을 요청하여 무인 실행을 계속할 수 없습니다.",

  "tasklist.empty": "📭 아직 예약 작업이 없습니다.",
  "tasklist.select": "예약 작업을 선택하세요:",
  "tasklist.details":
    "⏰ 예약 작업\n\n작업: {prompt}\n프로젝트: {project}\n일정: {schedule}\n{cronLine}시간대: {timezone}\n다음 실행: {nextRunAt}\n마지막 실행: {lastRunAt}\n실행 횟수: {runCount}",
  "tasklist.details.cron": "Cron: {cron}",
  "tasklist.button.delete": "🗑 삭제",
  "tasklist.button.cancel": "❌ 취소",
  "tasklist.deleted_callback": "삭제됨",
  "tasklist.inactive_callback": "이 예약 작업 메뉴는 비활성 상태입니다",
  "tasklist.load_error": "🔴 예약 작업을 불러오지 못했습니다.",

  "commands.select": "OpenCode 명령어를 선택하세요:",
  "commands.empty": "📭 이 프로젝트에서 사용 가능한 OpenCode 명령어가 없습니다.",
  "commands.fetch_error": "🔴 OpenCode 명령어를 불러오지 못했습니다.",
  "commands.no_description": "설명 없음",
  "commands.button.execute": "✅ 실행",
  "commands.button.cancel": "❌ 취소",
  "commands.confirm":
    "명령어 {command} 실행을 확인해 주세요. 인자와 함께 실행하려면 인자를 메시지로 보내주세요.",
  "commands.inactive_callback": "이 명령어 메뉴는 비활성 상태입니다",
  "commands.execute_callback": "명령어를 실행하는 중...",
  "commands.executing_prefix": "⚡ 명령어 실행 중:",
  "commands.arguments_empty": "⚠️ 인자는 비워 둘 수 없습니다. 텍스트를 보내거나 실행을 탭해 주세요.",
  "commands.execute_error": "🔴 OpenCode 명령어 실행에 실패했습니다.",
  "commands.select_page": "OpenCode 명령어를 선택하세요 ({page} 페이지):",
  "commands.button.prev_page": "⬅️ 이전",
  "commands.button.next_page": "다음 ➡️",
  "commands.page_empty_callback": "이 페이지에는 명령어가 없습니다",
  "commands.page_load_error_callback": "이 페이지를 불러올 수 없습니다. 다시 시도해 주세요.",
  "commands.download.no_roots": "허용된 탐색 루트가 설정되지 않았습니다.",
  "commands.download.downloading": "파일을 다운로드하는 중...",
  "commands.download.not_found": "파일을 찾을 수 없습니다",
  "commands.download.not_file": "경로가 파일이 아닙니다",
  "commands.download.file_too_large": "파일이 너무 큽니다",
  "commands.download.size": "크기",
  "commands.download.modified": "수정됨",
  "commands.download.error": "파일 다운로드에 실패했습니다.",

  "skills.select": "OpenCode 스킬을 선택하세요:",
  "skills.empty": "📭 이 프로젝트에서 사용 가능한 OpenCode 스킬이 없습니다.",
  "skills.fetch_error": "🔴 OpenCode 스킬을 불러오지 못했습니다.",
  "skills.no_description": "설명 없음",
  "skills.button.execute": "✅ 실행",
  "skills.button.cancel": "❌ 취소",
  "skills.confirm":
    "스킬 {skill} 실행을 확인해 주세요. 인자와 함께 실행하려면 인자를 메시지로 보내주세요.",
  "skills.inactive_callback": "이 스킬 메뉴는 비활성 상태입니다",
  "skills.execute_callback": "스킬을 사용하는 중...",
  "skills.executing_prefix": "⚡ 스킬 사용 중:",
  "skills.arguments_empty": "⚠️ 인자는 비워 둘 수 없습니다. 텍스트를 보내거나 실행을 탭해 주세요.",
  "skills.select_page": "OpenCode 스킬을 선택하세요 ({page} 페이지):",
  "skills.button.prev_page": "⬅️ 이전",
  "skills.button.next_page": "다음 ➡️",
  "skills.page_empty_callback": "이 페이지에는 스킬이 없습니다",
  "skills.page_load_error_callback": "이 페이지를 불러올 수 없습니다. 다시 시도해 주세요.",

  "mcps.select": "MCP 서버:",
  "mcps.empty": "📭 설정된 MCP 서버가 없습니다.",
  "mcps.fetch_error": "🔴 MCP 서버를 불러오지 못했습니다.",
  "mcps.toggle_error": "🔴 MCP 서버 전환에 실패했습니다.",
  "mcps.enabling": "활성화하는 중...",
  "mcps.disabling": "비활성화하는 중...",
  "mcps.status.connected": "🟢 연결됨",
  "mcps.status.disabled": "🔴 비활성화됨",
  "mcps.status.failed": "⚠️ 실패",
  "mcps.status.needs_auth": "🔒 인증 필요",
  "mcps.status.needs_client_registration": "🔒 등록 필요",
  "mcps.detail.title": "서버: {name}",
  "mcps.detail.status": "상태: {status}",
  "mcps.detail.error": "오류: {error}",
  "mcps.button.enable": "🟢 활성화",
  "mcps.button.disable": "🔴 비활성화",
  "mcps.button.back": "⬅️ 뒤로",
  "mcps.auth_required": "이 서버는 인증이 필요하여 봇에서 활성화할 수 없습니다.",

  "cmd.description.rename": "현재 세션 이름 변경",

  "legacy.models.fetch_error": "🔴 모델 목록을 가져오지 못했습니다. /status로 서버 상태를 확인해 주세요.",
  "legacy.models.empty": "📋 사용 가능한 모델이 없습니다. OpenCode에서 프로바이더를 설정해 주세요.",
  "legacy.models.header": "📋 사용 가능한 모델:\n\n",
  "legacy.models.no_provider_models": "  ⚠️ 사용 가능한 모델이 없습니다\n",
  "legacy.models.env_hint": "💡 .env에서 이 모델을 사용하려면:\n",
  "legacy.models.error": "🔴 모델 목록을 불러오는 중 오류가 발생했습니다.",

  "stt.recognizing": "🎤 오디오를 인식하는 중...",
  "stt.recognized": "🎤 인식 결과:\n{text}",
  "stt.not_configured":
    "🎤 음성 인식이 설정되지 않았습니다.\n\n사용하려면 .env에 STT_API_URL과 STT_API_KEY를 설정해 주세요.",
  "stt.error": "🔴 오디오 인식에 실패했습니다: {error}",
  "stt.empty_result": "🎤 오디오 메시지에서 음성을 감지하지 못했습니다.",

  "cmd.description.open": "디렉터리를 탐색하여 프로젝트 추가",
  "worktree.branch_detached": "detached HEAD",
  "worktree.select_with_current": "워크트리를 선택하세요:",
  "worktree.project_not_selected":
    "🏗 프로젝트가 선택되지 않았습니다.\n\n먼저 /projects로 프로젝트를 선택해 주세요.",
  "worktree.not_git_repo":
    "🌿 현재 프로젝트에서는 git 워크트리를 사용할 수 없습니다. 먼저 git 저장소를 선택해 주세요.",
  "worktree.not_git_repo_callback": "현재 프로젝트는 git 저장소가 아닙니다",
  "worktree.empty": "📭 현재 저장소에 git 워크트리가 없습니다.",
  "worktree.fetch_error": "🔴 git 워크트리를 불러오지 못했습니다.",
  "worktree.page_empty_callback": "이 페이지에는 워크트리가 없습니다",
  "worktree.selection_missing_callback": "선택한 워크트리를 더 이상 사용할 수 없습니다",
  "worktree.already_selected_callback": "이 워크트리는 이미 선택되어 있습니다",
  "worktree.selected":
    "✅ 워크트리 선택됨: {worktree}\n\n📋 세션이 초기화되었습니다. 계속하려면 /sessions 또는 /new를 사용해 주세요.",
  "worktree.select_error": "🔴 워크트리 선택에 실패했습니다.",
  "open.back": "⬆️ 위로",
  "open.roots": "📋 루트로 돌아가기",
  "open.prev_page": "⬅️ 이전",
  "open.next_page": "다음 ➡️",
  "open.select_current": "✅ 이 폴더 선택",
  "open.select_root": "📂 탐색할 루트 디렉터리를 선택하세요:",
  "open.access_denied": "⛔ 접근이 거부되었습니다: 허용된 루트 밖의 경로입니다",
  "open.scan_error": "🔴 디렉터리를 탐색할 수 없습니다: {error}",
  "open.open_error": "🔴 디렉터리 탐색기를 열지 못했습니다.",
  "open.selected": "✅ 프로젝트가 추가되었습니다: {project}\n\n📋 /sessions 또는 /new로 작업을 시작하세요.",
  "open.select_error": "🔴 프로젝트 추가에 실패했습니다.",
  "open.no_subfolders": "📭 하위 폴더 없음",
  "open.subfolder_count": "하위 폴더 {count}개",
  "open.subfolders_count": "하위 폴더 {count}개",
  "ls.access_denied": "⛔ 접근이 거부되었습니다: 현재 프로젝트 밖의 경로입니다",
  "ls.scan_error": "🔴 디렉터리를 조회할 수 없습니다",
  "ls.header": "디렉터리 조회",
  "ls.total": "총 {count}개 항목",
  "ls.file.header": "파일 정보",
  "ls.file.download": "📥 다운로드",
  "ls.file.back": "⬅️ 뒤로",
  "ls.file.attach": "📎 다음 메시지에 첨부",
  "attachment.added": "📎 첨부됨: {path}\n\n메시지를 보내면 파일이 함께 전송됩니다.",
  "attachment.cancel": "❌ 첨부 취소",
  "attachment.cancelled": "❌ 첨부가 취소되었습니다",
  "attachment.invalid": "⚠️ 첨부한 파일을 더 이상 사용할 수 없습니다. 파일 없이 메시지를 보냅니다.",
};
