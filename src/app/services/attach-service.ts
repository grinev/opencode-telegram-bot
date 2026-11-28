import type { Bot, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { isOpencodeServerHealthy } from "../../opencode/ready-refresh.js";
import type { AppContainer } from "../bootstrap/app-container.js";
import type { PermissionPromptChange, PermissionRequest } from "../types/permission.js";
import type { SessionInfo } from "../types/session.js";
import { clearSession, getCurrentSession, updateSelectedSessionTitle } from "./session-service.js";
import { getCurrentProject } from "../stores/settings-store.js";
import { resolveSessionParentChain } from "./recent-sessions-service.js";
import { resetStreamThrottle } from "../../bot/streaming/stream-throttle.js";
import { logger } from "../../utils/logger.js";
import {
  isExpectedOpencodeUnavailableError,
  isOpencodeNotFoundError,
} from "../../utils/opencode-error.js";

interface PrepareSessionMetricsParams {
  api: Bot<Context>["api"];
  chatId: number;
  session: SessionInfo;
  forceFullRestore?: boolean;
  sessionCreated?: boolean;
}

export interface AttachPresentationDeps {
  prepareSessionMetrics(params: PrepareSessionMetricsParams): Promise<void>;
  refreshRestoredSelection(api: Bot<Context>["api"], chatId: number, previousTitle?: string): Promise<void>;
  notifySessionRestored(chatId: number, session: SessionInfo): void;
  showCurrentQuestion(api: Bot<Context>["api"], chatId: number): Promise<void>;
  showPermissionRequest(
    api: Bot<Context>["api"],
    chatId: number,
    request: PermissionRequest,
  ): Promise<void>;
  applyPermissionPromptChanges(
    api: Bot<Context>["api"],
    chatId: number,
    changes: PermissionPromptChange[],
  ): Promise<void>;
  closeQuestionSettledOutside(api: Bot<Context>["api"], chatId: number): Promise<void>;
  closeQuestionNotAnswered(api: Bot<Context>["api"], chatId: number): Promise<void>;
}

type PendingQuestion = NonNullable<
  Awaited<ReturnType<typeof opencodeClient.question.list>>["data"]
>[number];
type PendingPermission = NonNullable<
  Awaited<ReturnType<typeof opencodeClient.permission.list>>["data"]
>[number];

let attachPresentation: AttachPresentationDeps | null = null;

let restoreInFlight: Promise<boolean> | null = null;

export function configureAttachPresentation(deps: AttachPresentationDeps | null): void {
  attachPresentation = deps;
}

export type AttachStateDeps = Pick<AppContainer, "attachManager">;

export type DetachSessionDeps = Pick<AppContainer, "attachManager" | "resetAggregator" | "goalManager"> &
  Partial<Pick<AppContainer, "manualCompaction">>;

type AttachRestoreDeps = Pick<
  AppContainer,
  "attachManager" | "permissionManager" | "questionManager" | "summaryAggregator" | "interactionManager"
> & Partial<Pick<AppContainer, "manualCompaction">>;

export interface AttachSessionDeps extends AttachRestoreDeps {
  bot: Bot<Context>;
  chatId: number;
  session: SessionInfo;
  ensureEventSubscription: (directory: string) => Promise<void>;
  forceFullRestore?: boolean | undefined;
  /** The session was created a moment ago, so it has no values to load. */
  sessionCreated?: boolean | undefined;
  goalService?: Pick<AppContainer, "goalService">["goalService"] | undefined;
}

export interface AttachSessionResult {
  busy: boolean;
  alreadyAttached: boolean;
  restoredQuestion: boolean;
  restoredPermissions: number;
}

export interface RestoreAttachedCurrentSessionDeps extends AttachRestoreDeps {
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

async function listPendingQuestions(directory: string): Promise<PendingQuestion[] | null> {
  const { data, error } = await opencodeClient.question.list({
    directory,
  });

  if (error || !data) {
    if (isExpectedOpencodeUnavailableError(error)) {
      logger.warn("[Attach] OpenCode server unavailable; skipping pending question restore");
    } else {
      logger.warn("[Attach] Failed to load pending questions during attach:", error);
    }
    return null;
  }

  return data;
}

async function listPendingPermissions(directory: string): Promise<PendingPermission[] | null> {
  const { data, error } = await opencodeClient.permission.list({
    directory,
  });

  if (error || !data) {
    if (isExpectedOpencodeUnavailableError(error)) {
      logger.warn("[Attach] OpenCode server unavailable; skipping pending permission restore");
    } else {
      logger.warn("[Attach] Failed to load pending permissions during attach:", error);
    }
    return null;
  }

  return data;
}

/**
 * Whether a pending request belongs to the followed session or one of its subagents.
 * The subagent links found on the way are registered, so its later events are followed.
 */
async function belongsToFollowedSession(
  deps: AttachRestoreDeps,
  requestSessionId: string,
  sessionId: string,
  directory: string,
): Promise<boolean> {
  const chain = await resolveSessionParentChain(requestSessionId, directory, new Set([sessionId]));
  if (!chain) {
    return false;
  }

  for (const link of chain.links.reverse()) {
    deps.summaryAggregator.registerRestoredPermissionChild(link.child, link.parent);
  }
  return true;
}

/**
 * Shows the first pending poll of the followed session or its subagents and queues the
 * rest, in OpenCode's order. True when a poll was shown or queued.
 */
async function restorePendingQuestions(
  deps: AttachRestoreDeps,
  bot: Bot<Context>,
  chatId: number,
  sessionId: string,
  directory: string,
  pending: PendingQuestion[],
  isAlreadyTracked: (requestID: string) => boolean = () => false,
): Promise<boolean> {
  if (!attachPresentation) {
    return false;
  }

  let restored = false;
  for (const request of pending) {
    if (isAlreadyTracked(request.id)) continue;
    if (!(await belongsToFollowedSession(deps, request.sessionID, sessionId, directory))) continue;

    const shown =
      !deps.manualCompaction?.isActive(sessionId) &&
      !deps.questionManager.isActive() &&
      deps.questionManager.startQuestions(request.questions, request.id, request.sessionID);
    if (shown) {
      await attachPresentation.showCurrentQuestion(bot.api, chatId);
    } else {
      deps.interactionManager.waitQuestion(request.questions, request.id, request.sessionID);
    }
    restored = true;
  }

  return restored;
}

async function restorePendingPermissions(
  deps: AttachRestoreDeps,
  bot: Bot<Context>,
  chatId: number,
  sessionId: string,
  directory: string,
  pending: PendingPermission[],
  isAlreadyTracked: (request: PermissionRequest) => boolean = () => false,
): Promise<number> {
  const pendingPermissions: PendingPermission[] = [];
  for (const request of pending) {
    if (isAlreadyTracked(request)) continue;
    if (!(await belongsToFollowedSession(deps, request.sessionID, sessionId, directory))) continue;
    pendingPermissions.push(request);
  }
  if (!attachPresentation) {
    return 0;
  }

  for (const request of pendingPermissions) {
    if (deps.manualCompaction?.isActive(sessionId) || deps.questionManager.isActive()) {
      deps.interactionManager.waitPermission(request);
    } else {
      await attachPresentation.showPermissionRequest(bot.api, chatId, request);
    }
  }

  return pendingPermissions.length;
}

/** Requests on screen or waiting at the moment OpenCode's pending lists were requested. */
interface TrackedRequestsSnapshot {
  shownQuestionId: string | null;
  waitingQuestionIds: string[];
  shownPermissionIds: string[];
  waitingPermissionIds: string[];
}

function snapshotTrackedRequests(deps: RestoreAfterReconnectDeps): TrackedRequestsSnapshot {
  return {
    shownQuestionId: deps.questionManager.getRequestID(),
    waitingQuestionIds: deps.interactionManager.getWaitingQuestionRequestIds(),
    shownPermissionIds: deps.permissionManager.getSettleableRequestIds(),
    waitingPermissionIds: deps.interactionManager.getWaitingPermissionRequestIds(),
  };
}

/**
 * After a reconnect, prompts on screen that OpenCode no longer has pending were settled
 * while the stream was down: they end as answered outside Telegram — or as not answered
 * when the server restarted, since they went with it — and waiting requests that are gone
 * leave the queue. Only requests tracked before the lists were requested are checked — one
 * that arrived meanwhile is missing from the lists without being settled. Answers or a
 * dismissal being sent from Telegram are left to that send.
 */
async function settleRequestsGoneWhileDisconnected(
  deps: RestoreAfterReconnectDeps,
  tracked: TrackedRequestsSnapshot,
  questions: PendingQuestion[] | null,
  permissions: PendingPermission[] | null,
  serverRestarted: boolean,
): Promise<void> {
  if (questions) {
    const pendingIds = new Set(questions.map((request) => request.id));
    for (const requestID of tracked.waitingQuestionIds) {
      if (!pendingIds.has(requestID)) deps.interactionManager.dropWaitingQuestion(requestID);
    }

    const shownId = tracked.shownQuestionId;
    if (
      shownId &&
      !pendingIds.has(shownId) &&
      deps.questionManager.getRequestID() === shownId &&
      !deps.questionManager.isSettlingFromTelegram() &&
      attachPresentation
    ) {
      if (serverRestarted) {
        await attachPresentation.closeQuestionNotAnswered(deps.bot.api, deps.chatId);
      } else {
        await attachPresentation.closeQuestionSettledOutside(deps.bot.api, deps.chatId);
      }
    }
  }

  if (permissions) {
    const pendingIds = new Set(permissions.map((request) => request.id));
    for (const requestID of tracked.waitingPermissionIds) {
      if (!pendingIds.has(requestID)) deps.interactionManager.dropWaitingPermission(requestID);
    }

    const settleable = new Set(deps.permissionManager.getSettleableRequestIds());
    const changes = tracked.shownPermissionIds
      .filter((requestID) => !pendingIds.has(requestID) && settleable.has(requestID))
      .flatMap((requestID) =>
        deps.permissionManager.settleRequest(requestID, null, serverRestarted),
      );
    if (changes.length > 0 && attachPresentation) {
      await attachPresentation.applyPermissionPromptChanges(deps.bot.api, deps.chatId, changes);
    }
  }
}

/** A poll already on screen or waiting, so a restore must not show it again. */
function isQuestionTracked(deps: AttachRestoreDeps, requestID: string): boolean {
  return (
    deps.questionManager.getRequestID() === requestID ||
    deps.interactionManager.isWaitingOrReleasing(requestID)
  );
}

/** A permission already on screen, settled or waiting, so a restore must not show it again. */
function isPermissionTracked(deps: AttachRestoreDeps, request: PermissionRequest): boolean {
  return (
    deps.permissionManager.hasRequest(request.id) ||
    deps.permissionManager.isResolved(request.id) ||
    deps.interactionManager.isWaitingOrReleasing(request.id)
  );
}

export async function attachToSession(deps: AttachSessionDeps): Promise<AttachSessionResult> {
  const { bot, chatId, session, ensureEventSubscription, forceFullRestore = false } = deps;
  const { attachManager, permissionManager, questionManager, summaryAggregator } = deps;
  const alreadyAttached = attachManager.isAttachedSession(session.id, session.directory);
  deps.manualCompaction?.select(session.id);

  deps.goalService?.follow(session.id);

  await attachPresentation?.prepareSessionMetrics({
    api: bot.api,
    chatId,
    session,
    forceFullRestore,
    sessionCreated: deps.sessionCreated ?? false,
  });

  if (!alreadyAttached) {
    await ensureEventSubscription(session.directory);
  }
  summaryAggregator.setSession(session.id);
  summaryAggregator.setBotAndChatId(bot, chatId);
  if (!alreadyAttached) attachManager.attach(session.id, session.directory);

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

  let restoredQuestion = false;
  let restoredPermissions = 0;

  if (
    (!alreadyAttached || forceFullRestore) &&
    !questionManager.isActive() &&
    !permissionManager.isActive()
  ) {
    const pendingQuestions = await listPendingQuestions(session.directory);
    restoredQuestion = pendingQuestions
      ? await restorePendingQuestions(
          deps,
          bot,
          chatId,
          session.id,
          session.directory,
          pendingQuestions,
          (requestID) => isQuestionTracked(deps, requestID),
        )
      : false;

    const pendingPermissions = await listPendingPermissions(session.directory);
    restoredPermissions = pendingPermissions
      ? await restorePendingPermissions(
          deps,
          bot,
          chatId,
          session.id,
          session.directory,
          pendingPermissions,
          (request) => isPermissionTracked(deps, request),
        )
      : 0;
  }

  await deps.goalService?.refresh(session.id, session.directory, false);

  return {
    busy,
    alreadyAttached,
    restoredQuestion,
    restoredPermissions,
  };
}

/**
 * Restores the followed session, joining a restore already in progress: the OpenCode ready
 * notification and the Telegram polling start both restore at startup. A joined restore
 * that failed (for example, the server was not ready yet) is attempted once more, so the
 * caller whose condition just changed still gets its own attempt.
 */
export async function restoreAttachedCurrentSession(
  deps: RestoreAttachedCurrentSessionDeps,
): Promise<boolean> {
  if (restoreInFlight) {
    logger.debug("[Attach] Followed session restore already in progress; joining it");
    const joined = await restoreInFlight;
    if (joined) {
      return true;
    }
    if (restoreInFlight) {
      // Another caller already retried after the failed restore; join that attempt.
      return restoreInFlight;
    }
    logger.debug("[Attach] Joined restore failed; retrying");
  }

  restoreInFlight = performAttachedCurrentSessionRestore(deps).finally(() => {
    restoreInFlight = null;
  });
  return restoreInFlight;
}

async function performAttachedCurrentSessionRestore(
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

    const { data, error } = await opencodeClient.session.get({
      sessionID: currentSession.id,
      directory: currentSession.directory,
    });
    const selected = getCurrentSession();
    const project = getCurrentProject();
    if (
      selected?.id !== currentSession.id ||
      selected.directory !== currentSession.directory ||
      project?.id !== currentProject.id ||
      project.worktree !== currentProject.worktree
    ) {
      return false;
    }
    if (isOpencodeNotFoundError(error)) {
      logger.info(`[Attach] Saved session is missing, clearing ${currentSession.id}`);
      clearSession();
      await attachPresentation?.refreshRestoredSelection(deps.bot.api, deps.chatId);
      return false;
    }
    // A title event may already have updated this session while the read was in flight.
    if (selected === currentSession && !error && data?.title &&
      updateSelectedSessionTitle(currentSession.id, data.title)
    ) {
      await attachPresentation?.refreshRestoredSelection(deps.bot.api, deps.chatId, currentSession.title);
    }
    const session = getCurrentSession();
    if (session?.id !== currentSession.id || session.directory !== currentSession.directory) return false;
    const { alreadyAttached } = await attachToSession({ ...deps, session });
    if (!alreadyAttached) attachPresentation?.notifySessionRestored(deps.chatId, session);
    logger.info(
      `[Attach] Restored followed session on startup: session=${currentSession.id}, directory=${currentSession.directory}`,
    );
    return true;
  } catch (error) {
    logger.error("[Attach] Failed to restore followed session on startup:", error);
    return false;
  }
}

/** Clears the in-flight restore guard (tests). */
export function __resetAttachRestoreForTests(): void {
  restoreInFlight = null;
}

/**
 * After a restart V2 resumes the interrupted run before the stream is back, so the resumed
 * turn's busy status was never seen: a busy session starts its turn from now, unless a turn
 * ended since `mark` was taken.
 */
async function startMissedLiveTurn(
  deps: RestoreAfterReconnectDeps,
  sessionId: string,
  directory: string,
  mark: number,
): Promise<void> {
  const { data: statuses, error } = await opencodeClient.session.status({ directory });
  if (error) {
    logger.warn("[Attach] Failed to load session status after a server restart:", error);
    return;
  }

  if (getAttachBusyStatus(sessionId, statuses)) {
    deps.summaryAggregator.startMissedLiveTurn(sessionId, mark);
  }
}

/**
 * The event stream does not replay what was missed while it was down, so after a reconnect
 * the prompts on screen are checked against what OpenCode still has pending, and the
 * followed session's pending questions and permissions are loaded again. Anything still
 * on screen or waiting is left alone. `serverRestarted` says the reconnect reached another
 * server process than before.
 */
export async function restorePendingInteractionsAfterReconnect(
  deps: RestoreAfterReconnectDeps,
  serverRestarted = false,
): Promise<void> {
  const attached = deps.attachManager.getSnapshot();
  if (!attached) {
    return;
  }

  const tracked = snapshotTrackedRequests(deps);
  const [pendingQuestions, pendingPermissions] = await Promise.all([
    listPendingQuestions(attached.directory),
    listPendingPermissions(attached.directory),
    serverRestarted
      ? startMissedLiveTurn(
          deps,
          attached.sessionId,
          attached.directory,
          deps.summaryAggregator.getTurnEndMark(),
        )
      : undefined,
  ]);

  await settleRequestsGoneWhileDisconnected(
    deps,
    tracked,
    pendingQuestions,
    pendingPermissions,
    serverRestarted,
  );

  const restoredQuestion = pendingQuestions
    ? await restorePendingQuestions(
        deps,
        deps.bot,
        deps.chatId,
        attached.sessionId,
        attached.directory,
        pendingQuestions,
        (requestID) => isQuestionTracked(deps, requestID),
      )
    : false;

  const restoredPermissions = pendingPermissions
    ? await restorePendingPermissions(
        deps,
        deps.bot,
        deps.chatId,
        attached.sessionId,
        attached.directory,
        pendingPermissions,
        (request) => isPermissionTracked(deps, request),
      )
    : 0;

  logger.info(
    `[Attach] Restored pending requests after event stream reconnect: session=${attached.sessionId}, question=${restoredQuestion}, permissions=${restoredPermissions}`,
  );
}

export function detachAttachedSession(reason: string, deps: DetachSessionDeps): void {
  deps.goalManager.clear();
  if (!deps.attachManager.isAttached()) {
    return;
  }

  const attachedSessionId = deps.attachManager.getSnapshot()?.sessionId;
  if (attachedSessionId) {
    deps.manualCompaction?.detach(attachedSessionId);
    resetStreamThrottle(attachedSessionId);
  }

  deps.resetAggregator();
  deps.attachManager.clear(reason);
}

export function markAttachedSessionBusy(
  sessionId: string,
  deps: AttachStateDeps,
): Promise<void> {
  deps.attachManager.markBusy(sessionId);
  return Promise.resolve();
}

export function markAttachedSessionIdle(
  sessionId: string,
  deps: AttachStateDeps,
): Promise<void> {
  deps.attachManager.markIdle(sessionId);
  return Promise.resolve();
}
