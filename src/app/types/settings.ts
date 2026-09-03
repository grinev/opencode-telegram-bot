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
  pinnedMessageId?: number | undefined;
  ttsMode?: "off" | "all" | "auto" | undefined;
  compactOutputMode?: boolean | undefined;
  deleteCompactProgressOnFinish?: boolean | undefined;
  showThinkingContent?: boolean | undefined;
  showAssistantRunFooter?: boolean | undefined;
  responseStreamingMode?: ResponseStreamingMode | undefined;
  sendDiffFileAttachments?: boolean | undefined;
  promptQueueEnabled?: boolean | undefined;
  sessionDirectoryCache?: SessionDirectoryCacheInfo | undefined;
  scheduledTasks?: ScheduledTask[] | undefined;
  scheduledTaskSessionIgnores?: ScheduledTaskSessionIgnoreInfo[] | undefined;
}
