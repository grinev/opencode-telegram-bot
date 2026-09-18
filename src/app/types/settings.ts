import type { ModelInfo } from "./model.js";
import type { ProjectInfo } from "./project.js";
import type { SessionDirectoryCacheInfo, SessionInfo } from "./session.js";
import type { ScheduledTask } from "./scheduled-task.js";

export type ResponseStreamingMode = "edit" | "draft";

export interface ScheduledTaskSessionIgnoreInfo {
  sessionId: string;
  createdAt: string;
}

export interface Settings {
  currentProject?: ProjectInfo | undefined;
  currentSession?: SessionInfo | undefined;
  currentAgent?: string | undefined;
  currentModel?: ModelInfo | undefined;
  /**
   * True only when the user picked a model via the in-bot picker.
   * In dynamic-model mode (OPENCODE_DYNAMIC_MODEL=true) prompts omit the
   * model param unless this is set, so the server's active model is used.
   */
  modelExplicitlySelected?: boolean | undefined;
  pinnedMessageId?: number | undefined;
  ttsMode?: "off" | "all" | "auto" | undefined;
  compactOutputMode?: boolean | undefined;
  deleteCompactProgressOnFinish?: boolean | undefined;
  showThinkingContent?: boolean | undefined;
  showAssistantRunFooter?: boolean | undefined;
  pinnedDashboardEnabled?: boolean | undefined;
  responseStreamingMode?: ResponseStreamingMode | undefined;
  sendDiffFileAttachments?: boolean | undefined;
  promptQueueEnabled?: boolean | undefined;
  globalRealTime?: boolean | undefined;
  sessionDirectoryCache?: SessionDirectoryCacheInfo | undefined;
  scheduledTasks?: ScheduledTask[] | undefined;
  scheduledTaskSessionIgnores?: ScheduledTaskSessionIgnoreInfo[] | undefined;
  alwaysAllowPermissions?: boolean | undefined;
  /** Tracks whether the user has completed their first run (used to skip auto-history-render on startup). */
  firstRunComplete?: boolean | undefined;
}
