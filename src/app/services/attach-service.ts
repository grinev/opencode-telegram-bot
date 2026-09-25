import type { Bot, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { isOpencodeServerHealthy } from "../../opencode/ready-refresh.js";
import type { AppContainer } from "../bootstrap/app-container.js";
import type { PermissionRequest } from "../types/permission.js";
import type { SessionInfo } from "../types/session.js";
import { clearSession, getCurrentSession } from "./session-service.js";
import { getCurrentProject } from "../stores/settings-store.js";
import { resolveSessionParentChain } from "./recent-sessions-service.js";
import { resetStreamThrottle } from "../../bot/streaming/stream-throttle.js";
import { logger } from "../../utils/logger.js";
import {
  isExpectedOpencodeUnavailableError,
  isOpencodeNotFoundError,
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

export type AttachStateDeps = Pick<AppContainer, "attachManager">;

export type DetachSessionDeps = Pick<AppContainer, "attachManager" | "resetAggregator">;

type AttachRestoreDeps = Pick<
  AppContainer,
  "attachManager" | "permissionManager" | "questionManager" | "summaryAggregator" | "interactionManager"
>;

export interface AttachSessionDeps extends AttachRestoreDeps {
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

export interface RestoreAttachedCurrentSessionDeps
  extends AttachRestoreDeps, Pick<AppContainer, "pinnedMessageManager"> {
  bot: Bot<Context>;
  chatId: number;
  ensureEventSubscription: (directory: string) => Promise<void>;
  forceFullRestore?: boolean;
}

export interface RestoreAfterReconnectDeps extends AttachRestoreDeps {
  bot: Bot<Context>;
  chatId: number;
}

function getAttachBusyStatus(
  sessionId: string,
  statuses: Record<string, { type?: string }> | undefined,
): boolean {
  return statuses?.[sessionId]?.type === "busy";
}

async function syncPinnedAttachState(deps: AttachStateDeps): Promise<void> {
  if (!attachPresentation) {
    return;
  }

  const attached = deps.attachManager.getSnapshot();
  await attachPresentation.syncAttachState(attached !== null, attached?.busy ?? false);
}

async function restorePendingQuestion(
  deps: AttachRestoreDeps,
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

  deps.questionManager.startQuestions(pendingQuestion.questions, pendingQuestion.id);
  await attachPresentation.showCurrentQuestion(bot.api, chatId);
  return true;
}

async function restorePendingPermissions(
  deps: AttachRestoreDeps,
  bot: Bot<Context>,
  chatId: number,
  sessionId: string,
  directory: string,
  questionActive: boolean,
  isAlreadyTracked: (request: PermissionRequest) => boolean = () => false,
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

  const pendingPermissions: typeof data = [];
  for (const request of data) {
    if (isAlreadyTracked(request)) continue;
    const chain = await resolveSessionParentChain(request.sessionID, directory, new Set([sessionId]));
    if (!chain) continue;
    for (const link of chain.links.reverse()) {
      deps.summaryAggregator.registerRestoredPermissionChild(link.child, link.parent);
    }
    pendingPermissions.push(request);
  }
  if (!attachPresentation) {
    return 0;
  }

  for (const request of pendingPermissions) {
    if (questionActive) {
      deps.interactionManager.waitPermission(request);
    } else {
      await attachPresentation.showPermissionRequest(bot.api, chatId, request);
    }
  }

  return pendingPermissions.length;
}

export async function attachToSession(deps: AttachSessionDeps): Promise<AttachSessionResult> {
  const { bot, chatId, session, ensureEventSubscription, forceFullRestore = false } = deps;
  const { attachManager, permissionManager, questionManager, summaryAggregator } = deps;
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

  await syncPinnedAttachState(deps);

  let restoredQuestion = false;
  let restoredPermissions = 0;

  if (
    (!alreadyAttached || forceFullRestore) &&
    !questionManager.isActive() &&
    !permissionManager.isActive()
  ) {
    restoredQuestion = await restorePendingQuestion(deps, bot, chatId, session.id, session.directory);

    restoredPermissions = await restorePendingPermissions(
      deps,
      bot,
      chatId,
      session.id,
      session.directory,
      restoredQuestion,
    );
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

    if (await dropSavedSessionIfMissing(currentSession, deps)) {
      return false;
    }

    await attachToSession({ ...deps, session: currentSession });
    logger.info(
      `[Attach] Restored followed session on startup: session=${currentSession.id}, directory=${currentSession.directory}`,
    );
    return true;
  } catch (error) {
    logger.error("[Attach] Failed to restore followed session on startup:", error);
    return false;
  }
}

/**
 * A saved session the server does not have (for example after switching the API version)
 * stops being the current session; prompts and commands then follow the no-session path.
 */
async function dropSavedSessionIfMissing(
  session: SessionInfo,
  deps: Pick<AppContainer, "pinnedMessageManager">,
): Promise<boolean> {
  const { error } = await opencodeClient.session.get({
    sessionID: session.id,
    directory: session.directory,
  });
  if (!isOpencodeNotFoundError(error)) {
    return false;
  }

  logger.info(
    `[Attach] Saved session no longer exists on the OpenCode server; clearing it: session=${session.id}, directory=${session.directory}`,
  );
  clearSession();
  if (deps.pinnedMessageManager.isInitialized()) {
    try {
      await deps.pinnedMessageManager.clear();
    } catch (clearError) {
      logger.warn("[Attach] Failed to clear pinned message for a missing session:", clearError);
    }
  }
  return true;
}

/**
 * The event stream does not replay what was missed while it was down, so after a reconnect
 * the attached session's pending question and permissions are loaded again. Anything
 * already on screen or waiting is left alone.
 */
export async function restorePendingInteractionsAfterReconnect(
  deps: RestoreAfterReconnectDeps,
): Promise<void> {
  const attached = deps.attachManager.getSnapshot();
  if (!attached) {
    return;
  }

  const questionShown =
    deps.questionManager.isActive() || deps.interactionManager.getWaitingKind() === "question";
  const restoredQuestion = questionShown
    ? false
    : await restorePendingQuestion(deps, deps.bot, deps.chatId, attached.sessionId, attached.directory);

  const restoredPermissions = await restorePendingPermissions(
    deps,
    deps.bot,
    deps.chatId,
    attached.sessionId,
    attached.directory,
    questionShown || restoredQuestion,
    (request) =>
      deps.permissionManager.hasRequest(request.id) || deps.permissionManager.isResolved(request.id),
  );

  logger.info(
    `[Attach] Restored pending requests after event stream reconnect: session=${attached.sessionId}, question=${restoredQuestion}, permissions=${restoredPermissions}`,
  );
}

export function detachAttachedSession(reason: string, deps: DetachSessionDeps): void {
  if (!deps.attachManager.isAttached()) {
    return;
  }

  const attachedSessionId = deps.attachManager.getSnapshot()?.sessionId;
  if (attachedSessionId) {
    resetStreamThrottle(attachedSessionId);
  }

  deps.resetAggregator();
  deps.attachManager.clear(reason);
  void syncPinnedAttachState(deps);
}

export async function markAttachedSessionBusy(
  sessionId: string,
  deps: AttachStateDeps,
): Promise<void> {
  if (!deps.attachManager.markBusy(sessionId)) {
    return;
  }

  await syncPinnedAttachState(deps);
}

export async function markAttachedSessionIdle(
  sessionId: string,
  deps: AttachStateDeps,
): Promise<void> {
  if (!deps.attachManager.markIdle(sessionId)) {
    return;
  }

  await syncPinnedAttachState(deps);
}
