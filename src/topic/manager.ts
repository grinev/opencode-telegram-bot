import {
  TOPIC_SESSION_STATUS,
  TopicSessionBinding,
  TopicSessionStatus,
  clearTopicSessionBinding,
  getCurrentProject,
  getScopedSessions,
  findTopicSessionBindingByScopeKey,
  findTopicSessionBindingBySessionId,
  getTopicSessionBinding,
  getTopicSessionBindings,
  getTopicSessionBindingsByChat,
  setTopicSessionBinding,
  updateTopicSessionBindingStatus,
} from "../settings/manager.js";
import { getScopeForSession } from "../session/manager.js";
import { SCOPE_CONTEXT, getScopeFromKey } from "../bot/scope.js";
import { logger } from "../utils/logger.js";

const BINDING_KEY_SEPARATOR = ":";
let hydratedFromScopedSessions = false;

export interface TopicBindingInput {
  scopeKey: string;
  chatId: number;
  threadId: number;
  sessionId: string;
  projectId: string;
  projectWorktree?: string;
  topicName?: string;
  status?: TopicSessionStatus;
}

export interface SessionRouteTarget {
  scopeKey: string;
  chatId: number;
  threadId: number | null;
}

function nowTimestamp(): number {
  return Date.now();
}

export function createTopicBindingKey(chatId: number, threadId: number): string {
  return `${chatId}${BINDING_KEY_SEPARATOR}${threadId}`;
}

function buildBinding(
  input: TopicBindingInput,
  existing?: TopicSessionBinding,
): TopicSessionBinding {
  const timestamp = nowTimestamp();

  return {
    scopeKey: input.scopeKey,
    chatId: input.chatId,
    threadId: input.threadId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    projectWorktree: input.projectWorktree,
    topicName: input.topicName,
    status: input.status ?? existing?.status ?? TOPIC_SESSION_STATUS.ACTIVE,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    closedAt: existing?.closedAt,
  };
}

function ensureTopicBindingsHydrated(): void {
  if (hydratedFromScopedSessions) {
    return;
  }

  hydratedFromScopedSessions = true;

  const scopedSessions = getScopedSessions();
  for (const [scopeKey, sessionInfo] of Object.entries(scopedSessions)) {
    const scope = getScopeFromKey(scopeKey);
    if (!scope || scope.context !== SCOPE_CONTEXT.GROUP_TOPIC || scope.threadId === null) {
      continue;
    }

    const bindingKey = createTopicBindingKey(scope.chatId, scope.threadId);
    const existingByTopic = getTopicSessionBinding(bindingKey);
    const existingBySession = findTopicSessionBindingBySessionId(sessionInfo.id);
    if (existingByTopic || existingBySession) {
      continue;
    }

    const project = getCurrentProject(scopeKey);
    if (!project) {
      continue;
    }

    const timestamp = nowTimestamp();
    const hydratedBinding: TopicSessionBinding = {
      scopeKey,
      chatId: scope.chatId,
      threadId: scope.threadId,
      sessionId: sessionInfo.id,
      projectId: project.id,
      projectWorktree: project.worktree,
      topicName: undefined,
      status: TOPIC_SESSION_STATUS.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setTopicSessionBinding(bindingKey, hydratedBinding);
    logger.info(
      `[TopicManager] Hydrated binding from scoped session: scope=${scopeKey}, session=${sessionInfo.id}`,
    );
  }
}

export function registerTopicSessionBinding(input: TopicBindingInput): TopicSessionBinding {
  ensureTopicBindingsHydrated();

  const bindingKey = createTopicBindingKey(input.chatId, input.threadId);
  const existingByTopic = getTopicSessionBinding(bindingKey);

  if (existingByTopic && existingByTopic.sessionId !== input.sessionId) {
    throw new Error(
      `[TopicManager] Topic ${bindingKey} is already bound to session ${existingByTopic.sessionId}`,
    );
  }

  const existingBySession = findTopicSessionBindingBySessionId(input.sessionId);
  if (existingBySession) {
    const existingBySessionKey = createTopicBindingKey(
      existingBySession.chatId,
      existingBySession.threadId,
    );
    if (existingBySessionKey !== bindingKey) {
      clearTopicSessionBinding(existingBySessionKey);
      logger.warn(
        `[TopicManager] Rebinding session ${input.sessionId} from topic ${existingBySessionKey} to ${bindingKey}`,
      );
    }
  }

  const nextBinding = buildBinding(input, existingByTopic);
  setTopicSessionBinding(bindingKey, nextBinding);

  logger.info(
    `[TopicManager] Registered topic binding: scope=${nextBinding.scopeKey}, session=${nextBinding.sessionId}, status=${nextBinding.status}`,
  );

  return nextBinding;
}

export function getTopicBinding(chatId: number, threadId: number): TopicSessionBinding | undefined {
  ensureTopicBindingsHydrated();
  return getTopicSessionBinding(createTopicBindingKey(chatId, threadId));
}

export function getTopicBindingByScopeKey(scopeKey: string): TopicSessionBinding | undefined {
  ensureTopicBindingsHydrated();
  return findTopicSessionBindingByScopeKey(scopeKey);
}

export function getTopicBindingBySessionId(sessionId: string): TopicSessionBinding | undefined {
  ensureTopicBindingsHydrated();
  return findTopicSessionBindingBySessionId(sessionId);
}

export function getTopicBindingsByChat(chatId: number): TopicSessionBinding[] {
  ensureTopicBindingsHydrated();
  return getTopicSessionBindingsByChat(chatId);
}

export function listAllTopicBindings(): TopicSessionBinding[] {
  ensureTopicBindingsHydrated();
  return Object.values(getTopicSessionBindings());
}

export function updateTopicBindingStatus(
  chatId: number,
  threadId: number,
  status: TopicSessionStatus,
): void {
  ensureTopicBindingsHydrated();
  const bindingKey = createTopicBindingKey(chatId, threadId);
  updateTopicSessionBindingStatus(bindingKey, status);
}

export function updateTopicBindingStatusBySessionId(
  sessionId: string,
  status: TopicSessionStatus,
): void {
  ensureTopicBindingsHydrated();
  const binding = findTopicSessionBindingBySessionId(sessionId);
  if (!binding) {
    return;
  }

  updateTopicSessionBindingStatus(createTopicBindingKey(binding.chatId, binding.threadId), status);
}

export function updateTopicBindingNameBySessionId(sessionId: string, topicName: string): void {
  ensureTopicBindingsHydrated();

  const binding = findTopicSessionBindingBySessionId(sessionId);
  if (!binding) {
    return;
  }

  const bindingKey = createTopicBindingKey(binding.chatId, binding.threadId);
  const nextBinding: TopicSessionBinding = {
    ...binding,
    topicName,
    updatedAt: nowTimestamp(),
  };

  setTopicSessionBinding(bindingKey, nextBinding);
}

export function removeTopicBinding(chatId: number, threadId: number): void {
  ensureTopicBindingsHydrated();
  clearTopicSessionBinding(createTopicBindingKey(chatId, threadId));
}

export function getSessionRouteTarget(sessionId: string): SessionRouteTarget | null {
  ensureTopicBindingsHydrated();
  const binding = findTopicSessionBindingBySessionId(sessionId);
  if (binding) {
    return {
      scopeKey: binding.scopeKey,
      chatId: binding.chatId,
      threadId: binding.threadId,
    };
  }

  const scopeKey = getScopeForSession(sessionId);
  if (!scopeKey) {
    return null;
  }

  const scope = getScopeFromKey(scopeKey);
  if (!scope) {
    return null;
  }

  return {
    scopeKey,
    chatId: scope.chatId,
    threadId: scope.threadId,
  };
}
