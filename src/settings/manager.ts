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
  startTime: string;
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export const TOPIC_SESSION_STATUS = {
  ACTIVE: "active",
  CLOSED: "closed",
  STALE: "stale",
  ABANDONED: "abandoned",
  ERROR: "error",
} as const;

export type TopicSessionStatus = (typeof TOPIC_SESSION_STATUS)[keyof typeof TOPIC_SESSION_STATUS];

export interface TopicSessionBinding {
  scopeKey: string;
  chatId: number;
  threadId: number;
  sessionId: string;
  projectId: string;
  projectWorktree?: string;
  topicName?: string;
  status: TopicSessionStatus;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface Settings {
  scopedProjects?: Record<string, ProjectInfo>;
  scopedSessions?: Record<string, SessionInfo>;
  scopedAgents?: Record<string, string>;
  scopedModels?: Record<string, ModelInfo>;
  scopedPinnedMessageIds?: Record<string, number>;
  topicSessionBindings?: Record<string, TopicSessionBinding>;
  serverProcess?: ServerProcessInfo;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
}

const GLOBAL_SCOPE_KEY = "global";

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

function getScopedMap<T>(map: Record<string, T> | undefined, scopeKey: string): T | undefined {
  return map?.[scopeKey];
}

function setScopedMapValue<T>(
  map: Record<string, T> | undefined,
  scopeKey: string,
  value: T,
): Record<string, T> {
  return {
    ...(map ?? {}),
    [scopeKey]: value,
  };
}

function clearScopedMapValue<T>(
  map: Record<string, T> | undefined,
  scopeKey: string,
): Record<string, T> | undefined {
  if (!map || !(scopeKey in map)) {
    return map;
  }

  const rest = Object.fromEntries(
    Object.entries(map).filter(([key]) => key !== scopeKey),
  ) as Record<string, T>;

  return Object.keys(rest).length > 0 ? rest : undefined;
}

function isTopicSessionStatus(value: unknown): value is TopicSessionStatus {
  return Object.values(TOPIC_SESSION_STATUS).includes(value as TopicSessionStatus);
}

function sanitizeTopicSessionBindings(
  value: unknown,
): Record<string, TopicSessionBinding> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const sanitizedEntries = Object.entries(value)
    .map(([bindingKey, rawBinding]) => {
      if (!rawBinding || typeof rawBinding !== "object") {
        return null;
      }

      const binding = rawBinding as Partial<TopicSessionBinding>;
      const now = Date.now();

      const chatId = typeof binding.chatId === "number" ? binding.chatId : null;
      const threadId = typeof binding.threadId === "number" ? binding.threadId : null;
      const sessionId = typeof binding.sessionId === "string" ? binding.sessionId : "";
      const projectId = typeof binding.projectId === "string" ? binding.projectId : "";
      const scopeKey = typeof binding.scopeKey === "string" ? binding.scopeKey : "";

      if (chatId === null || threadId === null || !sessionId || !projectId || !scopeKey) {
        return null;
      }

      const createdAt = typeof binding.createdAt === "number" ? binding.createdAt : now;
      const updatedAt = typeof binding.updatedAt === "number" ? binding.updatedAt : createdAt;

      const sanitizedBinding: TopicSessionBinding = {
        scopeKey,
        chatId,
        threadId,
        sessionId,
        projectId,
        projectWorktree:
          typeof binding.projectWorktree === "string" ? binding.projectWorktree : undefined,
        topicName: typeof binding.topicName === "string" ? binding.topicName : undefined,
        status: isTopicSessionStatus(binding.status) ? binding.status : TOPIC_SESSION_STATUS.ACTIVE,
        createdAt,
        updatedAt,
        closedAt: typeof binding.closedAt === "number" ? binding.closedAt : undefined,
      };

      return [bindingKey, sanitizedBinding] as const;
    })
    .filter((entry): entry is readonly [string, TopicSessionBinding] => entry !== null);

  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries);
}

export function getCurrentProject(scopeKey: string = GLOBAL_SCOPE_KEY): ProjectInfo | undefined {
  return getScopedMap(currentSettings.scopedProjects, scopeKey);
}

export function setCurrentProject(
  projectInfo: ProjectInfo,
  scopeKey: string = GLOBAL_SCOPE_KEY,
): void {
  currentSettings.scopedProjects = setScopedMapValue(
    currentSettings.scopedProjects,
    scopeKey,
    projectInfo,
  );
  void writeSettingsFile(currentSettings);
}

export function clearProject(scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedProjects = clearScopedMapValue(currentSettings.scopedProjects, scopeKey);
  void writeSettingsFile(currentSettings);
}

export function getCurrentSession(scopeKey: string = GLOBAL_SCOPE_KEY): SessionInfo | undefined {
  return getScopedMap(currentSettings.scopedSessions, scopeKey);
}

export function setCurrentSession(
  sessionInfo: SessionInfo,
  scopeKey: string = GLOBAL_SCOPE_KEY,
): void {
  currentSettings.scopedSessions = setScopedMapValue(
    currentSettings.scopedSessions,
    scopeKey,
    sessionInfo,
  );
  void writeSettingsFile(currentSettings);
}

export function clearSession(scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedSessions = clearScopedMapValue(currentSettings.scopedSessions, scopeKey);
  void writeSettingsFile(currentSettings);
}

export function getScopedSessions(): Record<string, SessionInfo> {
  return { ...(currentSettings.scopedSessions ?? {}) };
}

export function setScopedSession(scopeKey: string, sessionInfo: SessionInfo): void {
  setCurrentSession(sessionInfo, scopeKey);
}

export function clearScopedSession(scopeKey: string): void {
  clearSession(scopeKey);
}

export function getCurrentAgent(scopeKey: string = GLOBAL_SCOPE_KEY): string | undefined {
  return getScopedMap(currentSettings.scopedAgents, scopeKey);
}

export function setCurrentAgent(agentName: string, scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedAgents = setScopedMapValue(
    currentSettings.scopedAgents,
    scopeKey,
    agentName,
  );
  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedAgents = clearScopedMapValue(currentSettings.scopedAgents, scopeKey);
  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(scopeKey: string = GLOBAL_SCOPE_KEY): ModelInfo | undefined {
  return getScopedMap(currentSettings.scopedModels, scopeKey);
}

export function setCurrentModel(modelInfo: ModelInfo, scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedModels = setScopedMapValue(
    currentSettings.scopedModels,
    scopeKey,
    modelInfo,
  );
  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(scopeKey: string = GLOBAL_SCOPE_KEY): void {
  currentSettings.scopedModels = clearScopedMapValue(currentSettings.scopedModels, scopeKey);
  void writeSettingsFile(currentSettings);
}

export function getScopedPinnedMessageId(scopeKey: string): number | undefined {
  return getScopedMap(currentSettings.scopedPinnedMessageIds, scopeKey);
}

export function setScopedPinnedMessageId(scopeKey: string, messageId: number): void {
  currentSettings.scopedPinnedMessageIds = setScopedMapValue(
    currentSettings.scopedPinnedMessageIds,
    scopeKey,
    messageId,
  );
  void writeSettingsFile(currentSettings);
}

export function clearScopedPinnedMessageId(scopeKey: string): void {
  currentSettings.scopedPinnedMessageIds = clearScopedMapValue(
    currentSettings.scopedPinnedMessageIds,
    scopeKey,
  );
  void writeSettingsFile(currentSettings);
}

export function getTopicSessionBindings(): Record<string, TopicSessionBinding> {
  return { ...(currentSettings.topicSessionBindings ?? {}) };
}

export function getTopicSessionBinding(bindingKey: string): TopicSessionBinding | undefined {
  return getScopedMap(currentSettings.topicSessionBindings, bindingKey);
}

export function setTopicSessionBinding(bindingKey: string, binding: TopicSessionBinding): void {
  currentSettings.topicSessionBindings = setScopedMapValue(
    currentSettings.topicSessionBindings,
    bindingKey,
    binding,
  );
  void writeSettingsFile(currentSettings);
}

export function clearTopicSessionBinding(bindingKey: string): void {
  currentSettings.topicSessionBindings = clearScopedMapValue(
    currentSettings.topicSessionBindings,
    bindingKey,
  );
  void writeSettingsFile(currentSettings);
}

export function findTopicSessionBindingBySessionId(
  sessionId: string,
): TopicSessionBinding | undefined {
  return Object.values(currentSettings.topicSessionBindings ?? {}).find(
    (binding) => binding.sessionId === sessionId,
  );
}

export function findTopicSessionBindingByScopeKey(
  scopeKey: string,
): TopicSessionBinding | undefined {
  return Object.values(currentSettings.topicSessionBindings ?? {}).find(
    (binding) => binding.scopeKey === scopeKey,
  );
}

export function getTopicSessionBindingsByChat(chatId: number): TopicSessionBinding[] {
  return Object.values(currentSettings.topicSessionBindings ?? {}).filter(
    (binding) => binding.chatId === chatId,
  );
}

export function updateTopicSessionBindingStatus(
  bindingKey: string,
  status: TopicSessionStatus,
): void {
  const binding = getTopicSessionBinding(bindingKey);
  if (!binding) {
    return;
  }

  const updatedBinding: TopicSessionBinding = {
    ...binding,
    status,
    updatedAt: Date.now(),
    closedAt:
      status === TOPIC_SESSION_STATUS.CLOSED || status === TOPIC_SESSION_STATUS.STALE
        ? Date.now()
        : binding.closedAt,
  };

  setTopicSessionBinding(bindingKey, updatedBinding);
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
    currentProject?: unknown;
    currentSession?: unknown;
    currentAgent?: unknown;
    currentModel?: unknown;
    pinnedMessageId?: unknown;
    topicSessionBindings?: unknown;
  };

  let dirty = false;

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    dirty = true;
  }

  if ("currentProject" in loadedSettings) {
    delete loadedSettings.currentProject;
    dirty = true;
  }
  if ("currentSession" in loadedSettings) {
    delete loadedSettings.currentSession;
    dirty = true;
  }
  if ("currentAgent" in loadedSettings) {
    delete loadedSettings.currentAgent;
    dirty = true;
  }
  if ("currentModel" in loadedSettings) {
    delete loadedSettings.currentModel;
    dirty = true;
  }
  if ("pinnedMessageId" in loadedSettings) {
    delete loadedSettings.pinnedMessageId;
    dirty = true;
  }

  const sanitizedTopicSessionBindings = sanitizeTopicSessionBindings(
    loadedSettings.topicSessionBindings,
  );

  if (loadedSettings.topicSessionBindings !== undefined) {
    const loadedCount =
      loadedSettings.topicSessionBindings && typeof loadedSettings.topicSessionBindings === "object"
        ? Object.keys(loadedSettings.topicSessionBindings as Record<string, unknown>).length
        : 0;
    const sanitizedCount = Object.keys(sanitizedTopicSessionBindings ?? {}).length;
    if (loadedCount !== sanitizedCount) {
      dirty = true;
      logger.warn(
        `[SettingsManager] Removed ${loadedCount - sanitizedCount} invalid topic-session bindings during load`,
      );
    }
  }

  loadedSettings.topicSessionBindings = sanitizedTopicSessionBindings;

  currentSettings = loadedSettings;

  if (dirty) {
    void writeSettingsFile(currentSettings);
  }
}
