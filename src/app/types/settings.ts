import type { ModelInfo } from "./model.js";
import type { ProjectInfo } from "./project.js";
import type { SessionDirectoryCacheInfo, SessionInfo } from "./session.js";
import type { ScheduledTask } from "./scheduled-task.js";

export type ResponseStreamingMode = "edit" | "draft";

export type PromptQueueMode = "off" | "queue" | "steer";

export interface ScheduledTaskSessionIgnoreInfo {
  sessionId: string;
  createdAt: string;
}

/** Where one session's displayed replies stand, by the completion time of its latest reply. */
export interface SessionReplyReadPosition {
  /** The completion time of the latest reply shown to the chat. */
  readAt?: number | undefined;
  /** The completion time of the latest reply known to be unread, kept while a check fails. */
  unreadAt?: number | undefined;
}

/** The unread-reply marks of the `/recent` list, kept across restarts. */
export interface SessionReplyReadState {
  /** Replies completed before this moment read as already shown. */
  baselineAt: number;
  sessions: Record<string, SessionReplyReadPosition>;
}

/** Where the last full todo snapshot sits in the chat, and what it counted. */
export interface TodoSnapshotInfo {
  chatId: number;
  messageId: number;
  done: number;
  total: number;
}

export interface Settings {
  currentProject?: ProjectInfo | undefined;
  currentSession?: SessionInfo | undefined;
  currentAgent?: string | undefined;
  currentModel?: ModelInfo | undefined;
  pinnedMessageId?: number | undefined;
  ttsMode?: "off" | "all" | "auto" | undefined;
  compactOutputMode?: boolean | undefined;
  deleteCompactProgressOnFinish?: boolean | undefined;
  showThinkingContent?: boolean | undefined;
  showAssistantRunFooter?: boolean | undefined;
  pinnedDashboardEnabled?: boolean | undefined;
  showBackgroundSessionNotifications?: boolean | undefined;
  responseStreamingMode?: ResponseStreamingMode | undefined;
  sendDiffFileAttachments?: boolean | undefined;
  promptQueueEnabled?: boolean | undefined;
  promptQueueMode?: PromptQueueMode | undefined;
  sessionDirectoryCache?: SessionDirectoryCacheInfo | undefined;
  scheduledTasks?: ScheduledTask[] | undefined;
  scheduledTaskSessionIgnores?: ScheduledTaskSessionIgnoreInfo[] | undefined;
  sessionReplyReadState?: SessionReplyReadState | undefined;
  lastTodoSnapshot?: TodoSnapshotInfo | undefined;
}
