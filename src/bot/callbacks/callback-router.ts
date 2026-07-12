import type { Bot, Context } from "grammy";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { handleAgentSelect } from "./agent-selection-callback-handler.js";
import { handleCommandsCallback } from "./command-catalog-callback-handler.js";
import { handleCompactConfirm } from "./context-control-callback-handler.js";
import { handleCommitCallback } from "./commit-callback-handler.js";
import { handleDiffCallback } from "./diff-callback-handler.js";
import { handleGitCallback } from "./git-callback-handler.js";
import { handleLsCallback, handleOpenCallback } from "./file-browser-callback-handler.js";
import { handleInlineMenuCancel } from "./inline-menu-cancel-callback-handler.js";
import { handleMcpsCallback } from "./mcp-catalog-callback-handler.js";
import { handleMessagesCallback } from "./message-history-callback-handler.js";
import {
  handleModelSearchCallback,
  handleModelSearchResults,
  handleModelSelect,
} from "./model-selection-callback-handler.js";
import { handlePermissionCallback } from "./permission-callback-handler.js";
import { handleProjectSelect } from "./project-callback-handler.js";
import { handleQuestionCallback } from "./question-callback-handler.js";
import { handleRenameCancel } from "./rename-callback-handler.js";
import { handleSettingsCallback } from "./settings-callback-handler.js";
import {
  handleBackgroundSessionOpen,
  handleSessionSelect,
} from "./session-callback-handler.js";
import { handleSkillsCallback } from "./skills-catalog-callback-handler.js";
import {
  handleTaskCallback,
  handleTaskListCallback,
} from "./scheduled-task-callback-handler.js";
import { handleVariantSelect } from "./variant-selection-callback-handler.js";
import { handleWorktreeCallback } from "./worktree-callback-handler.js";
import { clearLsPathIndex, clearOpenPathIndex } from "../menus/file-browser-menu.js";

interface CallbackRouterDeps {
  ensureEventSubscription: (directory: string) => Promise<void>;
  setTelegramContext: (bot: Bot<Context>, chatId: number) => void;
}

export function registerCallbackRouter(bot: Bot<Context>, deps: CallbackRouterDeps): void {
  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      deps.setTelegramContext(bot, ctx.chat.id);
    }

    try {
      const handledBackgroundSession = await handleBackgroundSessionOpen(ctx, {
        bot,
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        clearOpenPathIndex();
        clearLsPathIndex();
      }
      const handledSession = await handleSessionSelect(ctx, {
        bot,
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledProject = await handleProjectSelect(ctx, {
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledWorktree = await handleWorktreeCallback(ctx, {
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledOpen = await handleOpenCallback(ctx, {
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledLs = await handleLsCallback(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModelSearch = await handleModelSearchCallback(ctx);
      const handledModelSearchResults = await handleModelSearchResults(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledSettings = await handleSettingsCallback(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, {
        bot,
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledMessages = await handleMessagesCallback(ctx, {
        bot,
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledSkills = await handleSkillsCallback(ctx, {
        bot,
        ensureEventSubscription: deps.ensureEventSubscription,
      });
      const handledMcps = await handleMcpsCallback(ctx);
      const handledGit = await handleGitCallback(ctx);
      const handledDiff = await handleDiffCallback(ctx);
      const handledCommit = await handleCommitCallback(ctx);

      logger.debug(
        `[Bot] Callback handled: backgroundSession=${handledBackgroundSession}, inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, worktree=${handledWorktree}, open=${handledOpen}, ls=${handledLs}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, modelSearch=${handledModelSearch}, modelSearchResults=${handledModelSearchResults}, model=${handledModel}, variant=${handledVariant}, settings=${handledSettings}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, messages=${handledMessages}, skills=${handledSkills}, mcps=${handledMcps}, git=${handledGit}, diff=${handledDiff}, commit=${handledCommit}`,
      );

      if (
        !handledBackgroundSession &&
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledWorktree &&
        !handledOpen &&
        !handledLs &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModelSearch &&
        !handledModelSearchResults &&
        !handledModel &&
        !handledVariant &&
        !handledSettings &&
        !handledCompactConfirm &&
        !handledTask &&
        !handledTaskList &&
        !handledRenameCancel &&
        !handledCommands &&
        !handledMessages &&
        !handledSkills &&
        !handledMcps &&
        !handledGit &&
        !handledDiff &&
        !handledCommit
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState("callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });
}
