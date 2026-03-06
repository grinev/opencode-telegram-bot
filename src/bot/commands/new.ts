import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, SessionInfo } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import {
  TOPIC_SESSION_STATUS,
  getCurrentProject,
  setCurrentAgent,
  setCurrentModel,
  setCurrentProject,
} from "../../settings/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import {
  GENERAL_TOPIC_THREAD_ID,
  GLOBAL_SCOPE_KEY,
  SCOPE_CONTEXT,
  createScopeKeyFromParams,
  getScopeFromContext,
  getThreadSendOptions,
  isTopicScope,
} from "../scope.js";
import { TOPIC_COLORS } from "../../topic/colors.js";
import { registerTopicSessionBinding } from "../../topic/manager.js";
import { syncTopicTitleForSession } from "../../topic/title-sync.js";
import { formatTopicTitle } from "../../topic/title-format.js";
import {
  BOT_I18N_KEY,
  CHAT_TYPE,
  TELEGRAM_CHAT_FIELD,
  TELEGRAM_ERROR_MARKER,
} from "../constants.js";
import { INTERACTION_CLEAR_REASON } from "../../interaction/constants.js";
import { buildTopicMessageLink } from "../utils/topic-link.js";
import type { TextPartInput } from "@opencode-ai/sdk/v2";

const NEW_COMMAND_TOPIC_SYNC = {
  TITLE_POLL_ATTEMPTS: 8,
  TITLE_POLL_DELAY_MS: 2000,
} as const;

function parseNewCommandPrompt(ctx: CommandContext<Context>): string {
  const text = ctx.message?.text ?? "";
  const parts = text.trim().split(/\s+/);
  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(1).join(" ");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSessionTitleAndSyncTopic(
  ctx: CommandContext<Context>,
  sessionId: string,
  directory: string,
): Promise<void> {
  for (let attempt = 0; attempt < NEW_COMMAND_TOPIC_SYNC.TITLE_POLL_ATTEMPTS; attempt++) {
    await wait(NEW_COMMAND_TOPIC_SYNC.TITLE_POLL_DELAY_MS);

    const { data, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory,
    });

    if (error || !data?.title) {
      continue;
    }

    try {
      const synced = await syncTopicTitleForSession(ctx.api, sessionId, data.title);
      if (synced) {
        return;
      }
    } catch (renameError) {
      logger.debug("[Bot] Failed to sync topic title during /new polling", {
        sessionId,
        error: renameError,
      });
      return;
    }
  }
}

function isGeneralForumScope(ctx: CommandContext<Context>): boolean {
  const scope = getScopeFromContext(ctx);
  const isForumEnabled =
    ctx.chat?.type === CHAT_TYPE.SUPERGROUP &&
    Reflect.get(ctx.chat, TELEGRAM_CHAT_FIELD.IS_FORUM) === true;

  return Boolean(
    isForumEnabled &&
    scope?.context === SCOPE_CONTEXT.GROUP_GENERAL &&
    (scope.threadId === null || scope.threadId === GENERAL_TOPIC_THREAD_ID),
  );
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  const description =
    typeof error === "object" && error !== null ? Reflect.get(error, "description") : null;
  if (typeof description === "string") {
    return description.toLowerCase();
  }

  return String(error).toLowerCase();
}

export async function newCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scope = getScopeFromContext(ctx);
    const scopeKey = scope?.key ?? GLOBAL_SCOPE_KEY;

    if (isTopicScope(scope)) {
      await ctx.reply(t(BOT_I18N_KEY.NEW_TOPIC_ONLY_IN_GENERAL));
      return;
    }

    if (!isGeneralForumScope(ctx)) {
      await ctx.reply(t(BOT_I18N_KEY.NEW_REQUIRES_FORUM_GENERAL));
      return;
    }

    const currentProject = getCurrentProject(scopeKey);
    if (!currentProject) {
      await ctx.reply(t("new.project_not_selected"));
      return;
    }

    logger.debug("[Bot] Creating new session for forum topic", {
      scopeKey,
      project: currentProject.worktree,
    });

    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      throw error || new Error("No data received from server");
    }

    const initialPrompt = parseNewCommandPrompt(ctx);
    const topicTitle = formatTopicTitle(session.title, session.title);

    const createdTopic = await ctx.api.createForumTopic(ctx.chat!.id, topicTitle, {
      icon_color: TOPIC_COLORS.BLUE,
    });

    const topicThreadId = createdTopic.message_thread_id;
    const topicScopeKey = createScopeKeyFromParams({
      chatId: ctx.chat!.id,
      threadId: topicThreadId,
      context: SCOPE_CONTEXT.GROUP_TOPIC,
    });

    const sessionInfo: SessionInfo = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };

    setCurrentProject(currentProject, topicScopeKey);
    setCurrentSession(sessionInfo, topicScopeKey);
    setCurrentAgent(getStoredAgent(scopeKey), topicScopeKey);
    setCurrentModel(getStoredModel(scopeKey), topicScopeKey);

    registerTopicSessionBinding({
      scopeKey: topicScopeKey,
      chatId: ctx.chat!.id,
      threadId: topicThreadId,
      sessionId: session.id,
      projectId: currentProject.id,
      projectWorktree: currentProject.worktree,
      topicName: topicTitle,
      status: TOPIC_SESSION_STATUS.ACTIVE,
    });

    summaryAggregator.setSession(session.id);
    clearAllInteractionState(INTERACTION_CLEAR_REASON.SESSION_CREATED, topicScopeKey);
    await ingestSessionInfoForCache(session);

    if (!pinnedMessageManager.isInitialized(topicScopeKey)) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat!.id, topicScopeKey, topicThreadId);
    }

    keyboardManager.initialize(ctx.api, ctx.chat!.id, topicScopeKey);

    try {
      await pinnedMessageManager.onSessionChange(session.id, session.title, topicScopeKey);
    } catch (errorOnPinned) {
      logger.error("[Bot] Error creating pinned message for new topic", errorOnPinned);
    }

    if (pinnedMessageManager.getContextLimit(topicScopeKey) === 0) {
      await pinnedMessageManager.refreshContextLimit(topicScopeKey);
    }

    const currentAgent = getStoredAgent(topicScopeKey);
    const currentModel = getStoredModel(topicScopeKey);
    const contextInfo =
      pinnedMessageManager.getContextInfo(topicScopeKey) ??
      keyboardManager.getContextInfo(topicScopeKey) ??
      (pinnedMessageManager.getContextLimit(topicScopeKey) > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit(topicScopeKey) }
        : null);
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );

    const topicReadyMessage = await ctx.api.sendMessage(
      ctx.chat!.id,
      t(BOT_I18N_KEY.NEW_TOPIC_CREATED, { title: session.title }),
      {
        ...getThreadSendOptions(topicThreadId),
        reply_markup: keyboard,
      },
    );

    const topicMessageLink = buildTopicMessageLink(ctx.chat, topicReadyMessage.message_id);
    const generalReplyText = topicMessageLink
      ? `${t(BOT_I18N_KEY.NEW_GENERAL_CREATED)}\n${t(BOT_I18N_KEY.NEW_GENERAL_OPEN_LINK, { url: topicMessageLink })}`
      : t(BOT_I18N_KEY.NEW_TOPIC_CREATE_ERROR);

    await ctx.reply(generalReplyText, getThreadSendOptions(scope?.threadId ?? null));

    if (initialPrompt.length > 0) {
      const promptModel = getStoredModel(topicScopeKey);
      const promptAgent = getStoredAgent(topicScopeKey);
      const promptOptions: {
        sessionID: string;
        directory: string;
        parts: TextPartInput[];
        model?: { providerID: string; modelID: string };
        agent?: string;
        variant?: string;
      } = {
        sessionID: session.id,
        directory: currentProject.worktree,
        parts: [{ type: "text", text: initialPrompt }],
        agent: promptAgent,
      };

      if (promptModel.providerID && promptModel.modelID) {
        promptOptions.model = {
          providerID: promptModel.providerID,
          modelID: promptModel.modelID,
        };

        if (promptModel.variant) {
          promptOptions.variant = promptModel.variant;
        }
      }

      safeBackgroundTask({
        taskName: "new.session.prompt",
        task: () => opencodeClient.session.prompt(promptOptions),
        onError: (promptError) => {
          logger.error("[Bot] Failed to send prompt from /new", {
            sessionId: session.id,
            promptError,
          });
        },
      });

      safeBackgroundTask({
        taskName: "new.session.topic_title_sync",
        task: () => pollSessionTitleAndSyncTopic(ctx, session.id, currentProject.worktree),
      });
    }
  } catch (error) {
    logger.error("[Bot] Error creating session/topic", error);
    const errorText = getErrorText(error);

    if (errorText.includes(TELEGRAM_ERROR_MARKER.NOT_ENOUGH_RIGHTS_CREATE_TOPIC)) {
      await ctx.reply(t(BOT_I18N_KEY.NEW_TOPIC_CREATE_NO_RIGHTS));
      return;
    }

    await ctx.reply(t(BOT_I18N_KEY.NEW_TOPIC_CREATE_ERROR));
  }
}
