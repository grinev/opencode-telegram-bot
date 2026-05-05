import type { Bot, Context } from "grammy";
import { opencodeClient } from "../opencode/client.js";
import { isOpencodeServerHealthy } from "../opencode/ready-refresh.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { keyboardManager } from "../keyboard/manager.js";
import { questionManager } from "../question/manager.js";
import { permissionManager } from "../permission/manager.js";
import { showCurrentQuestion } from "../bot/handlers/question.js";
import { showPermissionRequest } from "../bot/handlers/permission.js";
import type { SessionInfo } from "../session/manager.js";
import { getCurrentSession } from "../session/manager.js";
import { getCurrentProject } from "../settings/manager.js";
import { attachManager } from "./manager.js";
import { logger } from "../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";

interface EnsureAttachPinnedSessionParams {
  api: Context["api"];
  chatId: number;
  session: SessionInfo;
  forceFullRestore?: boolean;
}

export interface AttachSessionDeps {
  bot: Bot<Context>;
  chatId: number;
  session: SessionInfo;
  ensureEventSubscription: (directory: string) => Promise<void>;
  forceFullRestore?: boolean;
}

export interface AttachSessionResult {
  busy: boolean;
  alreadyAttached: boolean;
  restoredQuestion: boolean;
  restoredPermissions: number;
}

export interface RestoreAttachedCurrentSessionDeps {
  bot: Bot<Context>;
  chatId: number;
  ensureEventSubscription: (directory: string) => Promise<void>;
  forceFullRestore?: boolean;
}

function getAttachBusyStatus(sessionId: string, statuses: unknown): boolean {
  if (!statuses || typeof statuses !== "object") {
    return false;
  }

  const sessionStatus = (statuses as Record<string, { type?: string }>)[sessionId];
  return sessionStatus?.type === "busy";
}

async function ensureAttachPinnedSession({
  api,
  chatId,
  session,
  forceFullRestore = false,
}: EnsureAttachPinnedSessionParams): Promise<void> {
  if (!pinnedMessageManager.isInitialized()) {
    pinnedMessageManager.initialize(api, chatId);
  }

  keyboardManager.initialize(api, chatId);

  const pinnedState = pinnedMessageManager.getState();
  if (pinnedState.sessionId === session.id && pinnedState.messageId) {
    if (forceFullRestore) {
      await pinnedMessageManager.loadContextFromHistory(session.id, session.directory);
    }
    return;
  }

  if (pinnedState.messageId && pinnedState.sessionId === null) {
    await pinnedMessageManager.restoreExistingSession(session.id, session.title);
  } else {
    await pinnedMessageManager.onSessionChange(session.id, session.title);
  }

  await pinnedMessageManager.loadContextFromHistory(session.id, session.directory);

  const contextInfo = pinnedMessageManager.getContextInfo();
  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }
}

async function syncPinnedAttachState(): Promise<void> {
  if (!pinnedMessageManager.isInitialized()) {
    return;
  }

  const attached = attachManager.getSnapshot();
  await pinnedMessageManager.setAttachState(attached !== null, attached?.busy ?? false);
}

async function restorePendingQuestion(
  bot: Bot<Context>,
  chatId: number,
  sessionId: string,
  directory: string,
): Promise<boolean> {
  const { data, error } = await opencodeClient.question.list({
    directory,
  });

  if (error || !data) {
    if (isExpectedOpencodeUnavailableError(error)) {
      logger.warn("[Attach] OpenCode server unavailable; skipping pending question restore");
    } else {
      logger.warn("[Attach] Failed to load pending questions during attach:", error);
    }
    return false;
  }

  const pendingQuestion = data.find((request) => request.sessionID === sessionId);
  if (!pendingQuestion) {
    return false;
  }

  questionManager.startQuestions(pendingQuestion.questions, pendingQuestion.id);
  await showCurrentQuestion(bot.api, chatId);
  return true;
}

async function restorePendingPermissions(
  bot: Bot<Context>,
  chatId: number,
  sessionId: string,
  directory: string,
): Promise<number> {
  const { data, error } = await opencodeClient.permission.list({
    directory,
  });

  if (error || !data) {
    if (isExpectedOpencodeUnavailableError(error)) {
      logger.warn("[Attach] OpenCode server unavailable; skipping pending permission restore");
    } else {
      logger.warn("[Attach] Failed to load pending permissions during attach:", error);
    }
    return 0;
  }

  const pendingPermissions = data.filter((request) => request.sessionID === sessionId);
  for (const request of pendingPermissions) {
    await showPermissionRequest(bot.api, chatId, request);
  }

  return pendingPermissions.length;
}

export async function attachToSession(deps: AttachSessionDeps): Promise<AttachSessionResult> {
  const { bot, chatId, session, ensureEventSubscription, forceFullRestore = false } = deps;
  const alreadyAttached = attachManager.isAttachedSession(session.id, session.directory);

  await ensureAttachPinnedSession({
    api: bot.api,
    chatId,
    session,
    forceFullRestore,
  });

  if (!alreadyAttached) {
    await ensureEventSubscription(session.directory);
    summaryAggregator.setSession(session.id);
    summaryAggregator.setBotAndChatId(bot, chatId);
    attachManager.attach(session.id, session.directory);
  } else {
    summaryAggregator.setSession(session.id);
    summaryAggregator.setBotAndChatId(bot, chatId);
  }

  const { data: statuses, error: statusesError } = await opencodeClient.session.status({
    directory: session.directory,
  });

  if (statusesError) {
    if (isExpectedOpencodeUnavailableError(statusesError)) {
      logger.warn("[Attach] OpenCode server unavailable; skipping session status restore");
    } else {
      logger.warn("[Attach] Failed to load session status during attach:", statusesError);
    }
  }

  const busy = getAttachBusyStatus(session.id, statuses);
  if (busy) {
    attachManager.markBusy(session.id);
  } else {
    attachManager.markIdle(session.id);
  }

  await syncPinnedAttachState();

  let restoredQuestion = false;
  let restoredPermissions = 0;

  if (
    (!alreadyAttached || forceFullRestore) &&
    !questionManager.isActive() &&
    !permissionManager.isActive()
  ) {
    restoredQuestion = await restorePendingQuestion(bot, chatId, session.id, session.directory);

    if (!restoredQuestion) {
      restoredPermissions = await restorePendingPermissions(
        bot,
        chatId,
        session.id,
        session.directory,
      );
    }
  }

  return {
    busy,
    alreadyAttached,
    restoredQuestion,
    restoredPermissions,
  };
}

export async function restoreAttachedCurrentSession(
  deps: RestoreAttachedCurrentSessionDeps,
): Promise<boolean> {
  const currentProject = getCurrentProject();
  const currentSession = getCurrentSession();

  if (!currentProject || !currentSession) {
    return false;
  }

  if (currentSession.directory !== currentProject.worktree) {
    logger.warn(
      `[Attach] Skipping auto-restore because project/session mismatch: sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}`,
    );
    return false;
  }

  try {
    if (!(await isOpencodeServerHealthy())) {
      logger.warn(
        `[Attach] OpenCode server is unavailable; skipping followed session restore: session=${currentSession.id}, directory=${currentSession.directory}`,
      );
      return false;
    }

    await attachToSession({
      bot: deps.bot,
      chatId: deps.chatId,
      session: currentSession,
      ensureEventSubscription: deps.ensureEventSubscription,
      forceFullRestore: deps.forceFullRestore,
    });
    logger.info(
      `[Attach] Restored followed session on startup: session=${currentSession.id}, directory=${currentSession.directory}`,
    );
    return true;
  } catch (error) {
    logger.error("[Attach] Failed to restore followed session on startup:", error);
    return false;
  }
}

export function detachAttachedSession(reason: string): void {
  if (!attachManager.isAttached()) {
    return;
  }

  summaryAggregator.clear();
  attachManager.clear(reason);
  void syncPinnedAttachState();
}

export async function markAttachedSessionBusy(sessionId: string): Promise<void> {
  if (!attachManager.markBusy(sessionId)) {
    return;
  }

  await syncPinnedAttachState();
}

export async function markAttachedSessionIdle(sessionId: string): Promise<void> {
  if (!attachManager.markIdle(sessionId)) {
    return;
  }

  await syncPinnedAttachState();
}
