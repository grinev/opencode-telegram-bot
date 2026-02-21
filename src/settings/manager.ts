import type { ModelInfo } from "../model/types.js";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";

export interface ProjectInfo {
  id: string;
  worktree: string;
  name?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface ServerProcessInfo {
  pid: number;
  startTime: string; // ISO string
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export interface Settings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  serverProcess?: ServerProcessInfo;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
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

export function getServerProcess(): ServerProcessInfo | undefined {
  return currentSettings.serverProcess;
}

export function setServerProcess(processInfo: ServerProcessInfo): void {
  currentSettings.serverProcess = processInfo;
  void writeSettingsFile(currentSettings);
}

export function clearServerProcess(): void {
  currentSettings.serverProcess = undefined;
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

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    toolMessagesIntervalSec?: unknown;
  };

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    void writeSettingsFile(loadedSettings);
  }

  currentSettings = loadedSettings;
}
