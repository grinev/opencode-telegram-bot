import type { Bot, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { isOpencodeServerHealthy } from "../../opencode/ready-refresh.js";
import { summaryAggregator } from "../managers/summary-aggregation-manager.js";
import { questionManager } from "../managers/question-manager.js";
import { permissionManager } from "../managers/permission-manager.js";
import type { PermissionRequest } from "../types/permission.js";
import type { SessionInfo } from "../types/session.js";
import { clearSession, getCurrentSession } from "./session-service.js";
import { clearPinnedMessageId, clearProject, getCurrentProject } from "../stores/settings-store.js";
import { getProjects } from "./project-service.js";
import { attachManager } from "../managers/attach-manager.js";
import { resetStreamThrottle } from "../../bot/streaming/stream-throttle.js";
import { logger } from "../../utils/logger.js";
import {
  isExpectedOpencodeUnavailableError,
  isNotFoundError,
} from "../../utils/opencode-error.js";

interface EnsureAttachPinnedSessionParams {
  api: Bot<Context>["api"];
  chatId: number;
  session: SessionInfo;
  forceFullRestore?: boolean;
}

export interface AttachPresentationDeps {
  ensurePinnedSession(params: EnsureAttachPinnedSessionParams): Promise<void>;
  syncAttachState(attached: boolean, busy: boolean): Promise<void>;
  showCurrentQuestion(api: Bot<Context>["api"], chatId: number): Promise<void>;
  showPermissionRequest(
    api: Bot<Context>["api"],
    chatId: number,
    request: PermissionRequest,
  ): Promise<void>;
}

let attachPresentation: AttachPresentationDeps | null = null;

export function configureAttachPresentation(deps: AttachPresentationDeps | null): void {
  attachPresentation = deps;
}

export interface AttachSessionDeps {
  bot: Bot<Context>;
  chatId: number;
  session: SessionInfo;
  ensureEventSubscription: (directory: string) => Promise<void>;
  forceFullRestore?: boolean | undefined;
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

function getAttachBusyStatus(
  sessionId: string,
  statuses: Record<string, { type?: string }> | undefined,
): boolean {
  return statuses?.[sessionId]?.type === "busy";
}

async function syncPinnedAttachState(): Promise<void> {
  if (!attachPresentation) {
    return;
  }

  const attached = attachManager.getSnapshot();
  await attachPresentation.syncAttachState(attached !== null, attached?.busy ?? false);
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
  if (!pendingQuestion || !attachPresentation) {
    return false;
  }

  questionManager.startQuestions(pendingQuestion.questions, pendingQuestion.id);
  await attachPresentation.showCurrentQuestion(bot.api, chatId);
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
  if (!attachPresentation) {
    return 0;
  }

  for (const request of pendingPermissions) {
    await attachPresentation.showPermissionRequest(bot.api, chatId, request);
  }

  return pendingPermissions.length;
}

export async function attachToSession(deps: AttachSessionDeps): Promise<AttachSessionResult> {
  const { bot, chatId, session, ensureEventSubscription, forceFullRestore = false } = deps;
  const alreadyAttached = attachManager.isAttachedSession(session.id, session.directory);

  await attachPresentation?.ensurePinnedSession({
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

    // Validate that the stored session still exists on the server. A session
    // can disappear if the server storage is reset or the session is deleted
    // while the bot is stopped; restoring a ghost session would make every
    // prompt fail with "Session not found".
    const { error: sessionGetError } = await opencodeClient.session.get({
      sessionID: currentSession.id,
      directory: currentSession.directory,
    });

    if (sessionGetError) {
      if (!isNotFoundError(sessionGetError)) {
        logger.warn(
          `[Attach] Failed to validate stored session during restore; skipping restore: session=${currentSession.id}, directory=${currentSession.directory}`,
          sessionGetError,
        );
        return false;
      }

      logger.warn(
        `[Attach] Stored session no longer exists on the server; clearing stale session state: session=${currentSession.id}, directory=${currentSession.directory}`,
      );
      clearSession();
      // The pinned message points at the dead session; drop it so the next
      // startup does not try to restore an orphaned Telegram message.
      clearPinnedMessageId();

      // If the stored project is no longer visible (server list / whitelist),
      // clear it too so the bot does not stay pinned to an unreachable project.
      if (!(await isProjectVisible(currentProject.worktree))) {
        logger.warn(
          `[Attach] Stored project is no longer visible; clearing stale project: project=${currentProject.worktree}`,
        );
        clearProject();
      }

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

async function isProjectVisible(worktree: string): Promise<boolean> {
  try {
    const projects = await getProjects();
    return projects.some((project) => project.worktree === worktree);
  } catch (error) {
    logger.warn("[Attach] Failed to check project visibility:", error);
    return true;
  }
}

export function detachAttachedSession(reason: string): void {
  if (!attachManager.isAttached()) {
    return;
  }

  const attachedSessionId = attachManager.getSnapshot()?.sessionId;
  if (attachedSessionId) {
    resetStreamThrottle(attachedSessionId);
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
