import type { Bot, Context } from "grammy";
import { opencodeClient } from "../opencode/client.js";
import { stopEventListening } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { keyboardManager } from "../keyboard/manager.js";
import { questionManager } from "../question/manager.js";
import { permissionManager } from "../permission/manager.js";
import { showCurrentQuestion } from "../bot/handlers/question.js";
import { showPermissionRequest } from "../bot/handlers/permission.js";
import { renderAssistantFinalPartsSafe } from "../bot/utils/assistant-rendering.js";
import { sendRenderedBotPart } from "../bot/utils/telegram-text.js";
import type { SessionInfo } from "../session/manager.js";
import { getCurrentSession } from "../session/manager.js";
import { getCurrentProject } from "../settings/manager.js";
import { attachManager } from "./manager.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";

const LIVE_WATCH_MESSAGES_LIMIT = 24;
const LIVE_WATCH_INITIAL_BACKLOG_ITEMS = 6;
const LIVE_WATCH_POLL_INTERVAL_MS = 3000;

interface ConversationItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  created: number;
}

interface SessionWatchState {
  bot: Bot<Context>;
  chatId: number;
  session: SessionInfo;
  sentMessageIds: Set<string>;
  lastStatusType: string | null;
  timer: ReturnType<typeof setInterval> | null;
}

let activeSessionWatch: SessionWatchState | null = null;

function stopSessionWatch(reason: string): void {
  if (!activeSessionWatch) {
    return;
  }

  if (activeSessionWatch.timer) {
    clearInterval(activeSessionWatch.timer);
  }

  logger.info(
    `[Attach] Stopped session watch: session=${activeSessionWatch.session.id}, reason=${reason}`,
  );
  activeSessionWatch = null;
}

function extractTextParts(parts: Array<{ type: string; text?: string }>): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("").trim();
  return text.length > 0 ? text : null;
}

function buildConversationItems(
  messages: Array<{ info: { id: string; role: string; time?: { created?: number }; summary?: boolean }; parts: Array<{ type: string; text?: string }> }>,
): ConversationItem[] {
  return messages
    .map(({ info, parts }) => {
      const role = info.role;
      if (role !== "user" && role !== "assistant") {
        return null;
      }

      if (role === "assistant" && info.summary) {
        return null;
      }

      const text = extractTextParts(parts);
      if (!text) {
        return null;
      }

      return {
        id: info.id,
        role,
        text,
        created: info.time?.created ?? 0,
      } as ConversationItem;
    })
    .filter((item): item is ConversationItem => Boolean(item))
    .sort((a, b) => a.created - b.created);
}

async function sendConversationItem(bot: Bot<Context>, chatId: number, item: ConversationItem): Promise<void> {
  const label = item.role === "user" ? t("sessions.preview.you") : t("sessions.preview.agent");
  const renderedParts = renderAssistantFinalPartsSafe(`${label}\n\n${item.text}`);

  for (const part of renderedParts) {
    await sendRenderedBotPart({
      api: bot.api,
      chatId,
      part,
      options: { disable_notification: true },
    });
  }
}

async function pollSessionWatch(state: SessionWatchState, initial = false): Promise<void> {
  if (!activeSessionWatch || activeSessionWatch !== state) {
    return;
  }

  try {
    const [{ data: messages, error: messagesError }, { data: statuses, error: statusError }] =
      await Promise.all([
        opencodeClient.session.messages({
          sessionID: state.session.id,
          directory: state.session.directory,
          limit: LIVE_WATCH_MESSAGES_LIMIT,
        }),
        opencodeClient.session.status({
          directory: state.session.directory,
        }),
      ]);

    if (messagesError || !messages) {
      logger.warn("[Attach] Live watch failed to fetch session messages:", messagesError);
      return;
    }

    const items = buildConversationItems(
      messages as Array<{
        info: { id: string; role: string; time?: { created?: number }; summary?: boolean };
        parts: Array<{ type: string; text?: string }>;
      }>,
    );

    const pendingItems = initial
      ? items
          .slice(-LIVE_WATCH_INITIAL_BACKLOG_ITEMS)
          .filter((item) => !state.sentMessageIds.has(item.id))
      : items.filter((item) => !state.sentMessageIds.has(item.id));

    for (const item of pendingItems) {
      await sendConversationItem(state.bot, state.chatId, item);
      state.sentMessageIds.add(item.id);
    }

    if (!statusError && statuses) {
      const statusType = (statuses as Record<string, { type?: string }>)[state.session.id]?.type || "idle";
      if (statusType !== state.lastStatusType) {
        state.lastStatusType = statusType;
        const statusText =
          statusType === "busy"
            ? t("bot.thinking")
            : statusType === "retry"
              ? "🔁 Retrying"
              : "✅ Idle";
        await state.bot.api
          .sendMessage(state.chatId, statusText, { disable_notification: true })
          .catch(() => {});
      }
    }
  } catch (error) {
    logger.warn("[Attach] Live watch poll failed:", error);
  }
}

function startSessionWatch(bot: Bot<Context>, chatId: number, session: SessionInfo): void {
  stopSessionWatch("reattach");

  const state: SessionWatchState = {
    bot,
    chatId,
    session,
    sentMessageIds: new Set(),
    lastStatusType: null,
    timer: null,
  };

  state.timer = setInterval(() => {
    void pollSessionWatch(state, false);
  }, LIVE_WATCH_POLL_INTERVAL_MS);

  activeSessionWatch = state;
  logger.info(`[Attach] Started session watch: session=${session.id}`);
  void pollSessionWatch(state, true);
}

interface EnsureAttachPinnedSessionParams {
  api: Context["api"];
  chatId: number;
  session: SessionInfo;
}

export interface AttachSessionDeps {
  bot: Bot<Context>;
  chatId: number;
  session: SessionInfo;
  ensureEventSubscription: (directory: string) => Promise<void>;
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
}: EnsureAttachPinnedSessionParams): Promise<void> {
  if (!pinnedMessageManager.isInitialized()) {
    pinnedMessageManager.initialize(api, chatId);
  }

  keyboardManager.initialize(api, chatId);

  const pinnedState = pinnedMessageManager.getState();
  if (pinnedState.sessionId === session.id && pinnedState.messageId) {
    return;
  }

  await pinnedMessageManager.onSessionChange(session.id, session.title);
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
    logger.warn("[Attach] Failed to load pending questions during attach:", error);
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
    logger.warn("[Attach] Failed to load pending permissions during attach:", error);
    return 0;
  }

  const pendingPermissions = data.filter((request) => request.sessionID === sessionId);
  for (const request of pendingPermissions) {
    await showPermissionRequest(bot.api, chatId, request);
  }

  return pendingPermissions.length;
}

export async function attachToSession(deps: AttachSessionDeps): Promise<AttachSessionResult> {
  const { bot, chatId, session, ensureEventSubscription } = deps;
  const alreadyAttached = attachManager.isAttachedSession(session.id, session.directory);

  await ensureAttachPinnedSession({
    api: bot.api,
    chatId,
    session,
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
    logger.warn("[Attach] Failed to load session status during attach:", statusesError);
  }

  const busy = getAttachBusyStatus(session.id, statuses);
  if (busy) {
    attachManager.markBusy(session.id);
  } else {
    attachManager.markIdle(session.id);
  }

  startSessionWatch(bot, chatId, session);

  await syncPinnedAttachState();

  let restoredQuestion = false;
  let restoredPermissions = 0;

  if (!alreadyAttached && !questionManager.isActive() && !permissionManager.isActive()) {
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
    await attachToSession({
      bot: deps.bot,
      chatId: deps.chatId,
      session: currentSession,
      ensureEventSubscription: deps.ensureEventSubscription,
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

  stopSessionWatch(reason);
  stopEventListening();
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
