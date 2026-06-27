import type { ModelInfo } from "./model.js";
import type { ProjectInfo } from "./project.js";
import type { SessionDirectoryCacheInfo, SessionInfo } from "./session.js";
import type { ScheduledTask } from "./scheduled-task.js";

export interface ScheduledTaskSessionIgnoreInfo {
  sessionId: string;
  createdAt: string;
}

export interface Settings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  ttsMode?: "off" | "all" | "auto";
  compactOutputMode?: boolean;
  showThinkingContent?: boolean;
  sendDiffFileAttachments?: boolean;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
  scheduledTasks?: ScheduledTask[];
  scheduledTaskSessionIgnores?: ScheduledTaskSessionIgnoreInfo[];
}
