export const CHAT_TYPE = {
  PRIVATE: "private",
  GROUP: "group",
  SUPERGROUP: "supergroup",
  CHANNEL: "channel",
} as const;

export const TELEGRAM_CHAT_FIELD = {
  IS_FORUM: "is_forum",
  USERNAME: "username",
} as const;

export const GENERAL_TOPIC = {
  NAME: "🧭 Session Control",
} as const;

export const TELEGRAM_ERROR_MARKER = {
  NOT_ENOUGH_RIGHTS_CREATE_TOPIC: "not enough rights to create a topic",
} as const;

export const TELEGRAM_URL = {
  BASE: "https://t.me",
  PRIVATE_SUPERGROUP_PATH: "/c",
} as const;

export const TELEGRAM_CHAT_ID_PREFIX = {
  PRIVATE_SUPERGROUP: "100",
} as const;

export const BOT_I18N_KEY = {
  GROUP_GENERAL_PROMPTS_DISABLED: "group.general.prompts_disabled",
  GROUP_GENERAL_COMMANDS_ONLY: "group.general.commands_only",
  TOPIC_UNBOUND: "topic.unbound",
  TOPIC_CREATE_FROM_GENERAL: "topic.create_from_general",
  CLEANUP_TOPIC_USE_GENERAL: "cleanup.topic_use_general",
  CLEANUP_REQUIRES_FORUM_GENERAL: "cleanup.requires_forum_general",
  CLEANUP_NO_TOPICS: "cleanup.no_topics",
  CLEANUP_RESULT: "cleanup.result",
  NEW_TOPIC_ONLY_IN_GENERAL: "new.topic_only_in_general",
  NEW_REQUIRES_FORUM_GENERAL: "new.requires_forum_general",
  NEW_TOPIC_CREATE_ERROR: "new.topic_create_error",
  NEW_TOPIC_CREATE_NO_RIGHTS: "new.topic_create_no_rights",
  NEW_TOPIC_CREATED: "new.topic_created",
  NEW_GENERAL_CREATED: "new.general_created",
  NEW_GENERAL_OPEN_LINK: "new.general_open_link",
  SESSIONS_TOPIC_LOCKED: "sessions.topic_locked",
  SESSIONS_GENERAL_OVERVIEW: "sessions.general_overview",
  SESSIONS_GENERAL_ITEM: "sessions.general_item",
  SESSIONS_GENERAL_EMPTY: "sessions.general_empty",
  SESSIONS_BOUND_TOPIC_LINK: "sessions.bound_topic_link",
  SESSIONS_CREATED_TOPIC_LINK: "sessions.created_topic_link",
  PROJECTS_LOCKED_TOPIC_SCOPE: "projects.locked.topic_scope",
  PROJECTS_LOCKED_GROUP_PROJECT: "projects.locked.group_project",
  PROJECTS_LOCKED_CALLBACK: "projects.locked.callback",
} as const;
