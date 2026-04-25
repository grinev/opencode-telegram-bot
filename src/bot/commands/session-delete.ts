import { CommandContext, Context, InlineKeyboard } from "grammy";
import { getDateLocale, t } from "../../i18n/index.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { clearSession, getCurrentSession } from "../../session/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";
import { detachAttachedSession } from "../../attach/service.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";

const CALLBACK_PREFIX = "sesdel:";
const OPEN_PREFIX = `${CALLBACK_PREFIX}open:`;
const CONFIRM_PREFIX = `${CALLBACK_PREFIX}confirm:`;
const CANCEL = `${CALLBACK_PREFIX}cancel`;
const PAGE_PREFIX = `${CALLBACK_PREFIX}page:`;
const SESSION_FETCH_EXTRA_COUNT = 1;

type SessionListItem = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
};

type SessionPage = {
  sessions: SessionListItem[];
  hasNext: boolean;
  page: number;
};

interface SessionDeleteListMetadata {
  flow: "session_delete";
  stage: "list";
  messageId: number;
}

interface SessionDeleteDetailMetadata {
  flow: "session_delete";
  stage: "detail";
  messageId: number;
  sessionId: string;
  title: string;
}

type SessionDeleteMetadata = SessionDeleteListMetadata | SessionDeleteDetailMetadata;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseSessionDeleteMetadata(state: InteractionState | null): SessionDeleteMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;

  if (flow !== "session_delete" || typeof messageId !== "number") {
    return null;
  }

  if (stage === "list") {
    return { flow, stage, messageId };
  }

  if (stage === "detail") {
    const sessionId = state.metadata.sessionId;
    const title = state.metadata.title;
    if (typeof sessionId !== "string" || !sessionId || typeof title !== "string" || !title) {
      return null;
    }

    return { flow, stage, messageId, sessionId, title };
  }

  return null;
}

function clearSessionDeleteInteraction(reason: string): void {
  const metadata = parseSessionDeleteMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

function buildSessionPageCallback(page: number): string {
  return `${PAGE_PREFIX}${page}`;
}

function parseSessionPageCallback(data: string): number | null {
  if (!data.startsWith(PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

function truncateTitle(title: string, maxLength: number = 120): string {
  return title.length <= maxLength ? title : `${title.slice(0, maxLength - 3)}...`;
}

async function loadSessionPage(
  directory: string,
  page: number,
  pageSize: number,
): Promise<SessionPage> {
  const startIndex = page * pageSize;
  const endExclusive = startIndex + pageSize;

  const { data: sessions, error } = await opencodeClient.session.list({
    directory,
    limit: endExclusive + SESSION_FETCH_EXTRA_COUNT,
    roots: true,
  });

  if (error || !sessions) {
    throw error || new Error("No data received from server");
  }

  const hasNext = sessions.length > endExclusive;
  const pagedSessions = sessions.slice(startIndex, endExclusive);

  return {
    sessions: pagedSessions as SessionListItem[],
    hasNext,
    page,
  };
}

function buildSessionDeleteKeyboard(pageData: SessionPage, pageSize: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const localeForDate = getDateLocale();
  const pageStartIndex = pageData.page * pageSize;

  pageData.sessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const label = `${pageStartIndex + index + 1}. ${session.title} (${date})`;
    keyboard.text(label, `${OPEN_PREFIX}${session.id}`).row();
  });

  if (pageData.page > 0) {
    keyboard.text(
      t("session_delete.button.prev_page"),
      buildSessionPageCallback(pageData.page - 1),
    );
  }

  if (pageData.hasNext) {
    keyboard.text(
      t("session_delete.button.next_page"),
      buildSessionPageCallback(pageData.page + 1),
    );
  }

  if (pageData.page > 0 || pageData.hasNext) {
    keyboard.row();
  }

  keyboard.text(t("session_delete.button.cancel"), CANCEL);
  return keyboard;
}

function buildSessionDeleteConfirmKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("session_delete.button.delete"), `${CONFIRM_PREFIX}${sessionId}`)
    .text(t("session_delete.button.cancel"), CANCEL);
}

function formatSessionSelectText(page: number): string {
  if (page === 0) {
    return t("session_delete.select");
  }

  return t("session_delete.select_page", { page: page + 1 });
}

export async function sessionDeleteCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    const pageSize = config.bot.sessionsListLimit;
    const currentProject = getCurrentProject();

    if (!currentProject) {
      await ctx.reply(t("session_delete.project_not_selected"));
      return;
    }

    const firstPage = await loadSessionPage(currentProject.worktree, 0, pageSize);

    if (firstPage.sessions.length === 0) {
      await ctx.reply(t("session_delete.empty"));
      return;
    }

    const keyboard = buildSessionDeleteKeyboard(firstPage, pageSize);
    const message = await ctx.reply(formatSessionSelectText(firstPage.page), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "session_delete",
        stage: "list",
        messageId: message.message_id,
      },
    });
  } catch (error) {
    logger.error("[SessionDelete] Failed to open session delete list", error);
    await ctx.reply(t("session_delete.load_error"));
  }
}

export async function handleSessionDeleteCallback(ctx: Context): Promise<boolean> {
  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseSessionDeleteMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx
      .answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  try {
    if (data === CANCEL) {
      clearSessionDeleteInteraction("session_delete_cancelled");
      await ctx.answerCallbackQuery({ text: t("session_delete.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data.startsWith(OPEN_PREFIX)) {
      if (metadata.stage !== "list") {
        await ctx
          .answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true })
          .catch(() => {});
        return true;
      }

      const sessionId = data.slice(OPEN_PREFIX.length);
      if (!sessionId) {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
        return true;
      }

      const currentProject = getCurrentProject();
      if (!currentProject) {
        clearSessionDeleteInteraction("session_delete_no_project");
        await ctx.answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true }).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      const { data: session, error } = await opencodeClient.session.get({
        sessionID: sessionId,
        directory: currentProject.worktree,
      });

      if (error) {
        logger.error("[SessionDelete] Failed to fetch session details:", error);
        await ctx.answerCallbackQuery({ text: t("session_delete.load_error") });
        return true;
      }

      if (!session) {
        clearSessionDeleteInteraction("session_delete_not_found");
        await ctx.answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true }).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      const localeForDate = getDateLocale();
      const date = new Date(session.time.created).toLocaleDateString(localeForDate);

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        t("session_delete.details", {
          title: session.title,
          directory: session.directory,
          date,
        }),
        {
          reply_markup: buildSessionDeleteConfirmKeyboard(session.id),
        },
      );

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "session_delete",
          stage: "detail",
          messageId: metadata.messageId,
          sessionId: session.id,
          title: session.title,
        },
      });

      return true;
    }

    // Pagination (list stage only)
    const page = parseSessionPageCallback(data);
    if (page !== null) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true }).catch(() => {});
        return true;
      }

      const currentProject = getCurrentProject();
      if (!currentProject) {
        clearSessionDeleteInteraction("session_delete_page_no_project");
        await ctx.answerCallbackQuery({ text: t("session_delete.cancelled_callback") }).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      try {
        const pageSize = config.bot.sessionsListLimit;
        const pageData = await loadSessionPage(currentProject.worktree, page, pageSize);

        if (pageData.sessions.length === 0) {
          await ctx.answerCallbackQuery({ text: t("session_delete.page_empty_callback") });
          return true;
        }

        const keyboard = buildSessionDeleteKeyboard(pageData, pageSize);
        await ctx.editMessageText(formatSessionSelectText(pageData.page), {
          reply_markup: keyboard,
        });

        interactionManager.transition({
          expectedInput: "callback",
          metadata: {
            flow: "session_delete",
            stage: "list",
            messageId: metadata.messageId,
          },
        });
        await ctx.answerCallbackQuery();
      } catch (error) {
        logger.error("[SessionDelete] Error loading sessions page:", error);
        await ctx.answerCallbackQuery({ text: t("session_delete.page_load_error_callback") });
      }

      return true;
    }

    if (data.startsWith(CONFIRM_PREFIX)) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true }).catch(() => {});
        return true;
      }

      const sessionId = data.slice(CONFIRM_PREFIX.length);
      if (sessionId !== metadata.sessionId) {
        await ctx.answerCallbackQuery({ text: t("session_delete.inactive_callback"), show_alert: true }).catch(() => {});
        return true;
      }

      const currentProject = getCurrentProject();
      if (!currentProject) {
        clearSessionDeleteInteraction("session_delete_confirm_no_project");
        await ctx.answerCallbackQuery({ text: t("session_delete.cancelled_callback") }).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      try {
        const deleteResult = await opencodeClient.session.delete({
          sessionID: sessionId,
        });

        if (deleteResult.error) {
          logger.error("[SessionDelete] Delete failed:", deleteResult.error);
          await ctx.answerCallbackQuery({ text: t("session_delete.delete_error") });
          return true;
        }

        const currentSession = getCurrentSession();
        const isCurrent = currentSession?.id === sessionId;
        const shortTitle = truncateTitle(metadata.title);

        logger.info(`[SessionDelete] Session deleted: id=${sessionId}, title="${metadata.title}", wasCurrent=${isCurrent}`);

        if (isCurrent) {
          detachAttachedSession("session_delete_deleted_current");
          clearSession();
          summaryAggregator.clear();
          clearSessionDeleteInteraction("session_delete_deleted_current");
          try {
            await pinnedMessageManager.clear();
          } catch (err) {
            logger.error("[SessionDelete] Failed to clear pinned message:", err);
          }
          await ctx.answerCallbackQuery({ text: t("session_delete.deleted_current", { title: shortTitle }) });
        } else {
          clearSessionDeleteInteraction("session_delete_deleted");
          await ctx.answerCallbackQuery({ text: t("session_delete.deleted", { title: shortTitle }) });
        }

        await ctx.deleteMessage().catch(() => {});
      } catch (error) {
        logger.error("[SessionDelete] Delete failed:", error);
        await ctx.answerCallbackQuery({ text: t("session_delete.delete_error") });
      }

      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  } catch (error) {
    logger.error("[SessionDelete] Failed to handle callback", error);
    clearSessionDeleteInteraction("session_delete_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
