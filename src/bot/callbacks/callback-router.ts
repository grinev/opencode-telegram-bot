import type { Bot, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { InteractionErrorScope } from "../../app/managers/interaction-manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { handleAgentSelect } from "./agent-selection-callback-handler.js";
import { handleCommandsCallback } from "./command-catalog-callback-handler.js";
import { handleCompactConfirm } from "./context-control-callback-handler.js";
import { handleLsCallback, handleOpenCallback } from "./file-browser-callback-handler.js";
import { handleInlineMenuCancel } from "./inline-menu-cancel-callback-handler.js";
import { handleMcpsCallback } from "./mcp-catalog-callback-handler.js";
import { handleMessagesCallback } from "./message-history-callback-handler.js";
import {
  handleModelProvidersCallback,
  handleModelSearchCallback,
  handleModelSearchResults,
  handleModelSelect,
} from "./model-selection-callback-handler.js";
import { handlePermissionCallback } from "./permission-callback-handler.js";
import { handleProjectSelect } from "./project-callback-handler.js";
import { handlePromptAttachmentCancel } from "./prompt-attachment-callback-handler.js";
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

type CallbackHandler = (ctx: Context) => Promise<boolean>;

interface CallbackRoute {
  name: string;
  handlers: CallbackHandler[];
  errorScope: InteractionErrorScope;
}

interface CallbackRouterDeps {
  container: AppContainer;
}

function parseCallbackPrefix(data: string): string | null {
  const separatorIndex = data.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  return data.slice(0, separatorIndex);
}

export function registerCallbackRouter(bot: Bot<Context>, deps: CallbackRouterDeps): void {
  const { container } = deps;
  const botDeps = { ...container, bot };
  const routes = new Map<string, CallbackRoute>([
    [
      "agent",
      {
        name: "agent",
        handlers: [(ctx) => handleAgentSelect(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "attach",
      {
        name: "attach",
        handlers: [(ctx) => handlePromptAttachmentCancel(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "commands",
      {
        name: "commands",
        handlers: [(ctx) => handleCommandsCallback(ctx, botDeps)],
        errorScope: "interaction",
      },
    ],
    [
      "compact",
      { name: "compact", handlers: [handleCompactConfirm], errorScope: "interaction" },
    ],
    [
      "ls",
      {
        name: "ls",
        handlers: [(ctx) => handleLsCallback(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "mcps",
      {
        name: "mcps",
        handlers: [(ctx) => handleMcpsCallback(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "messages",
      {
        name: "messages",
        handlers: [(ctx) => handleMessagesCallback(ctx, botDeps)],
        errorScope: "interaction",
      },
    ],
    [
      "model",
      {
        name: "model",
        handlers: [
          (ctx) => handleModelSearchCallback(ctx, container),
          (ctx) => handleModelSearchResults(ctx, container),
          (ctx) => handleModelProvidersCallback(ctx, container),
          (ctx) => handleModelSelect(ctx, container),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "open",
      {
        name: "open",
        handlers: [(ctx) => handleOpenCallback(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "permission",
      {
        name: "permission",
        handlers: [(ctx) => handlePermissionCallback(ctx, container)],
        errorScope: "permission",
      },
    ],
    [
      "project",
      {
        name: "project",
        handlers: [(ctx) => handleProjectSelect(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "projects",
      {
        name: "projects",
        handlers: [(ctx) => handleProjectSelect(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "question",
      {
        name: "question",
        handlers: [(ctx) => handleQuestionCallback(ctx, container)],
        errorScope: "question",
      },
    ],
    [
      "rename",
      {
        name: "rename",
        handlers: [(ctx) => handleRenameCancel(ctx, container)],
        errorScope: "rename",
      },
    ],
    [
      "session",
      {
        name: "session",
        handlers: [(ctx) => handleSessionSelect(ctx, botDeps)],
        errorScope: "interaction",
      },
    ],
    [
      "settings",
      {
        name: "settings",
        handlers: [(ctx) => handleSettingsCallback(ctx, container)],
        errorScope: "none",
      },
    ],
    [
      "skills",
      {
        name: "skills",
        handlers: [(ctx) => handleSkillsCallback(ctx, botDeps)],
        errorScope: "interaction",
      },
    ],
    [
      "task",
      {
        name: "task",
        handlers: [(ctx) => handleTaskCallback(ctx, container)],
        errorScope: "taskCreation",
      },
    ],
    [
      "tasklist",
      {
        name: "tasklist",
        handlers: [(ctx) => handleTaskListCallback(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "variant",
      {
        name: "variant",
        handlers: [(ctx) => handleVariantSelect(ctx, container)],
        errorScope: "interaction",
      },
    ],
    [
      "worktree",
      {
        name: "worktree",
        handlers: [(ctx) => handleWorktreeCallback(ctx, container)],
        errorScope: "interaction",
      },
    ],
  ]);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    logger.debug(`[Bot] Received callback_query:data: ${data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      container.setTelegramContext(bot, ctx.chat.id);
    }

    let errorScope: InteractionErrorScope = "interaction";

    try {
      // Pre-hooks run before prefix dispatch.
      const handledBackgroundSession = await handleBackgroundSessionOpen(ctx, botDeps);
      if (handledBackgroundSession) {
        logger.debug(`[Bot] Callback handled: data=${data}, handler=backgroundSession`);
        return;
      }

      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        clearOpenPathIndex();
        clearLsPathIndex();
        logger.debug(`[Bot] Callback handled: data=${data}, handler=inlineMenuCancel`);
        return;
      }

      const prefix = parseCallbackPrefix(data);
      const route = prefix ? routes.get(prefix) : undefined;
      if (!route) {
        logger.debug("Unknown callback query:", data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
        return;
      }

      errorScope = route.errorScope;

      for (const handler of route.handlers) {
        if (await handler(ctx)) {
          logger.debug(`[Bot] Callback handled: data=${data}, route=${route.name}`);
          return;
        }
      }

      logger.debug("Unknown callback query:", data);
      await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      container.resetInteractionError(errorScope, "callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });
}
