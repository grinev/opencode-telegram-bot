export const INTERACTION_CLEAR_REASON = {
  MANUAL: "manual",
  STATE_REPLACED: "state_replaced",
  EXPIRED: "expired",
  QUESTION_ERROR: "question_error",
  QUESTION_REPLACED_BY_NEW_POLL: "question_replaced_by_new_poll",
  BOT_STARTUP: "bot_startup",
  CALLBACK_HANDLER_ERROR: "callback_handler_error",
  MESSAGE_HANDLER_ERROR: "message_handler_error",
  SESSION_MISMATCH_RESET: "session_mismatch_reset",
  SESSION_CREATED: "session_created",
  SESSION_SWITCHED: "session_switched",
  STOP_COMMAND: "stop_command",
  RENAME_CANCEL_INACTIVE: "rename_cancel_inactive",
  RENAME_CANCELLED: "rename_cancelled",
  RENAME_MISSING_SESSION_INFO: "rename_missing_session_info",
  RENAME_COMPLETED: "rename_completed",
  PROJECT_SWITCHED: "project_switched",
  PROJECT_SELECT_ERROR: "project_select_error",
  SESSION_SELECT_ERROR: "session_select_error",
} as const;

export type InteractionClearReasonValue =
  (typeof INTERACTION_CLEAR_REASON)[keyof typeof INTERACTION_CLEAR_REASON];
