import path from "node:path";
import type { ModelInfo } from "../types/model.js";
import type { ProjectInfo } from "../types/project.js";
import type { SessionDirectoryCacheInfo, SessionInfo } from "../types/session.js";
import { cloneScheduledTask, type ScheduledTask } from "../types/scheduled-task.js";
import type {
  ResponseStreamingMode,
  ScheduledTaskSessionIgnoreInfo,
  Settings,
} from "../types/settings.js";
import { config } from "../../config.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { logger } from "../../utils/logger.js";

function cloneScheduledTasks(tasks: ScheduledTask[] | undefined): ScheduledTask[] | undefined {
  return tasks?.map((task) => cloneScheduledTask(task));
}

function cloneScheduledTaskSessionIgnores(
  ignores: ScheduledTaskSessionIgnoreInfo[] | undefined,
): ScheduledTaskSessionIgnoreInfo[] | undefined {
  return ignores?.map((ignore) => ({ ...ignore }));
}

function getSettingsFilePath(): string {
  return getRuntimePaths().settingsFilePath;
}

async function readSettingsFile(): Promise<Settings> {
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(getSettingsFilePath(), "utf-8");
    return JSON.parse(content) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("[SettingsManager] Error reading settings file:", error);
    }
    return {};
  }
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

function writeSettingsFile(settings: Settings): Promise<void> {
  settingsWriteQueue = settingsWriteQueue
    .catch(() => {
      // Keep write queue alive after failed writes.
    })
    .then(async () => {
      try {
        const fs = await import("fs/promises");
        const settingsFilePath = getSettingsFilePath();
        await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
        await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2));
      } catch (err) {
        logger.error("[SettingsManager] Error writing settings file:", err);
      }
    });

  return settingsWriteQueue;
}

let currentSettings: Settings = {};

export function getCurrentProject(): ProjectInfo | undefined {
  return currentSettings.currentProject;
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  currentSettings.currentProject = projectInfo;
  void writeSettingsFile(currentSettings);
}

export function clearProject(): void {
  currentSettings.currentProject = undefined;
  void writeSettingsFile(currentSettings);
}

export function getCurrentSession(): SessionInfo | undefined {
  return currentSettings.currentSession;
}

export function setCurrentSession(sessionInfo: SessionInfo): void {
  currentSettings.currentSession = sessionInfo;
  void writeSettingsFile(currentSettings);
}

export function clearSession(): void {
  currentSettings.currentSession = undefined;
  void writeSettingsFile(currentSettings);
}

export type TtsMode = "off" | "all" | "auto";

export function getTtsMode(): TtsMode {
  return currentSettings.ttsMode ?? "off";
}

export function setTtsMode(mode: TtsMode): void {
  currentSettings.ttsMode = mode;
  void writeSettingsFile(currentSettings);
}

export function getCompactOutputMode(): boolean {
  return currentSettings.compactOutputMode ?? false;
}

export function setCompactOutputMode(enabled: boolean): void {
  currentSettings.compactOutputMode = enabled;
  void writeSettingsFile(currentSettings);
}

export function getShowThinkingContent(): boolean {
  return currentSettings.showThinkingContent ?? true;
}

export function setShowThinkingContent(enabled: boolean): void {
  currentSettings.showThinkingContent = enabled;
  void writeSettingsFile(currentSettings);
}

export function getShowAssistantRunFooter(): boolean {
  return currentSettings.showAssistantRunFooter ?? true;
}

export function setShowAssistantRunFooter(enabled: boolean): void {
  currentSettings.showAssistantRunFooter = enabled;
  void writeSettingsFile(currentSettings);
}

export type { ResponseStreamingMode };

export function getResponseStreamingMode(): ResponseStreamingMode {
  return currentSettings.responseStreamingMode === "draft" ? "draft" : "edit";
}

export function setResponseStreamingMode(mode: ResponseStreamingMode): void {
  currentSettings.responseStreamingMode = mode;
  void writeSettingsFile(currentSettings);
}

export function getSendDiffFileAttachments(): boolean {
  return currentSettings.sendDiffFileAttachments ?? true;
}

export function setSendDiffFileAttachments(enabled: boolean): void {
  currentSettings.sendDiffFileAttachments = enabled;
  void writeSettingsFile(currentSettings);
}

export function getCurrentAgent(): string | undefined {
  return currentSettings.currentAgent;
}

export function setCurrentAgent(agentName: string): void {
  currentSettings.currentAgent = agentName;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(): void {
  currentSettings.currentAgent = undefined;
  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(): ModelInfo | undefined {
  return currentSettings.currentModel;
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  currentSettings.currentModel = modelInfo;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(): void {
  currentSettings.currentModel = undefined;
  void writeSettingsFile(currentSettings);
}

export function getPinnedMessageId(): number | undefined {
  return currentSettings.pinnedMessageId;
}

export function setPinnedMessageId(messageId: number): void {
  currentSettings.pinnedMessageId = messageId;
  void writeSettingsFile(currentSettings);
}

export function clearPinnedMessageId(): void {
  currentSettings.pinnedMessageId = undefined;
  void writeSettingsFile(currentSettings);
}

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  return currentSettings.sessionDirectoryCache;
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  currentSettings.sessionDirectoryCache = cache;
  return writeSettingsFile(currentSettings);
}

export function clearSessionDirectoryCache(): void {
  currentSettings.sessionDirectoryCache = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScheduledTasks(): ScheduledTask[] {
  return cloneScheduledTasks(currentSettings.scheduledTasks) ?? [];
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  currentSettings.scheduledTasks = cloneScheduledTasks(tasks);
  return writeSettingsFile(currentSettings);
}

export function getScheduledTaskSessionIgnores(): ScheduledTaskSessionIgnoreInfo[] {
  return cloneScheduledTaskSessionIgnores(currentSettings.scheduledTaskSessionIgnores) ?? [];
}

export function setScheduledTaskSessionIgnores(
  ignores: ScheduledTaskSessionIgnoreInfo[],
): Promise<void> {
  currentSettings.scheduledTaskSessionIgnores = cloneScheduledTaskSessionIgnores(ignores);
  return writeSettingsFile(currentSettings);
}

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

const VALID_TTS_MODES: readonly TtsMode[] = ["off", "all", "auto"];
const VALID_STREAMING_MODES: readonly ResponseStreamingMode[] = ["edit", "draft"];

function applyInitialSettingsPreset(preset: Record<string, unknown>): void {
  const knownKeys = new Set([
    "ttsMode",
    "compactOutputMode",
    "showThinkingContent",
    "showAssistantRunFooter",
    "responseStreamingMode",
    "sendDiffFileAttachments",
  ]);

  for (const [key, value] of Object.entries(preset)) {
    if (!knownKeys.has(key)) {
      throw new Error(
        `INITIAL_SETTINGS_PRESET: unknown key "${key}". Supported keys: ${[...knownKeys].join(", ")}.`,
      );
    }
    if (key === "ttsMode") {
      if (typeof value !== "string" || !VALID_TTS_MODES.includes(value as TtsMode)) {
        throw new Error(
          `INITIAL_SETTINGS_PRESET: invalid value for "ttsMode"; expected one of ${VALID_TTS_MODES.join(", ")}.`,
        );
      }
      if (currentSettings.ttsMode === undefined) {
        currentSettings.ttsMode = value as TtsMode;
      }
    } else if (key === "responseStreamingMode") {
      if (
        typeof value !== "string" ||
        !VALID_STREAMING_MODES.includes(value as ResponseStreamingMode)
      ) {
        throw new Error(
          `INITIAL_SETTINGS_PRESET: invalid value for "responseStreamingMode"; expected one of ${VALID_STREAMING_MODES.join(", ")}.`,
        );
      }
      if (currentSettings.responseStreamingMode === undefined) {
        currentSettings.responseStreamingMode = value as ResponseStreamingMode;
      }
    } else {
      // Boolean settings: compactOutputMode, showThinkingContent, showAssistantRunFooter, sendDiffFileAttachments
      if (typeof value !== "boolean") {
        throw new Error(
          `INITIAL_SETTINGS_PRESET: "${key}" must be a boolean.`,
        );
      }
      switch (key) {
        case "compactOutputMode":
          if (currentSettings.compactOutputMode === undefined)
            currentSettings.compactOutputMode = value;
          break;
        case "showThinkingContent":
          if (currentSettings.showThinkingContent === undefined)
            currentSettings.showThinkingContent = value;
          break;
        case "showAssistantRunFooter":
          if (currentSettings.showAssistantRunFooter === undefined)
            currentSettings.showAssistantRunFooter = value;
          break;
        case "sendDiffFileAttachments":
          if (currentSettings.sendDiffFileAttachments === undefined)
            currentSettings.sendDiffFileAttachments = value;
          break;
      }
    }
  }
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    serverProcess?: unknown;
    toolMessagesIntervalSec?: unknown;
  };

  let requiresRewrite = false;

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    requiresRewrite = true;
  }

  if ("serverProcess" in loadedSettings) {
    delete loadedSettings.serverProcess;
    requiresRewrite = true;
  }

  // Migrate old ttsEnabled boolean to new ttsMode
  if ("ttsEnabled" in loadedSettings) {
    const oldEnabled = (loadedSettings as Record<string, unknown>).ttsEnabled;
    loadedSettings.ttsMode = oldEnabled === true ? "all" : "off";
    delete (loadedSettings as Record<string, unknown>).ttsEnabled;
    requiresRewrite = true;
  }

  currentSettings = loadedSettings;
  currentSettings.scheduledTasks = cloneScheduledTasks(loadedSettings.scheduledTasks) ?? [];
  currentSettings.scheduledTaskSessionIgnores =
    cloneScheduledTaskSessionIgnores(loadedSettings.scheduledTaskSessionIgnores) ?? [];

  applyInitialSettingsPreset(config.bot.initialSettingsPreset);

  if (requiresRewrite) {
    void writeSettingsFile(currentSettings);
  }
}
