import type { Bot, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  clearInteractionErrorState,
  type InteractionErrorScope,
} from "../../app/managers/interaction-manager.js";
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
  const routes = new Map<string, CallbackRoute>([
    [
      "agent",
      { name: "agent", handlers: [handleAgentSelect], errorScope: "interaction" },
    ],
    [
      "attach",
      { name: "attach", handlers: [handlePromptAttachmentCancel], errorScope: "interaction" },
    ],
    [
      "commands",
      {
        name: "commands",
        handlers: [
          (ctx) =>
            handleCommandsCallback(ctx, {
              bot,
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "compact",
      { name: "compact", handlers: [handleCompactConfirm], errorScope: "interaction" },
    ],
    [
      "ls",
      { name: "ls", handlers: [handleLsCallback], errorScope: "interaction" },
    ],
    [
      "mcps",
      { name: "mcps", handlers: [handleMcpsCallback], errorScope: "interaction" },
    ],
    [
      "messages",
      {
        name: "messages",
        handlers: [
          (ctx) =>
            handleMessagesCallback(ctx, {
              bot,
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "model",
      {
        name: "model",
        handlers: [
          handleModelSearchCallback,
          handleModelSearchResults,
          handleModelProvidersCallback,
          handleModelSelect,
        ],
        errorScope: "interaction",
      },
    ],
    [
      "open",
      {
        name: "open",
        handlers: [
          (ctx) =>
            handleOpenCallback(ctx, {
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "permission",
      { name: "permission", handlers: [handlePermissionCallback], errorScope: "permission" },
    ],
    [
      "project",
      {
        name: "project",
        handlers: [
          (ctx) =>
            handleProjectSelect(ctx, {
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "projects",
      {
        name: "projects",
        handlers: [
          (ctx) =>
            handleProjectSelect(ctx, {
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "question",
      { name: "question", handlers: [handleQuestionCallback], errorScope: "question" },
    ],
    [
      "rename",
      { name: "rename", handlers: [handleRenameCancel], errorScope: "rename" },
    ],
    [
      "session",
      {
        name: "session",
        handlers: [
          (ctx) =>
            handleSessionSelect(ctx, {
              bot,
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "settings",
      { name: "settings", handlers: [handleSettingsCallback], errorScope: "none" },
    ],
    [
      "skills",
      {
        name: "skills",
        handlers: [
          (ctx) =>
            handleSkillsCallback(ctx, {
              bot,
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
    [
      "task",
      { name: "task", handlers: [handleTaskCallback], errorScope: "taskCreation" },
    ],
    [
      "tasklist",
      { name: "tasklist", handlers: [handleTaskListCallback], errorScope: "interaction" },
    ],
    [
      "variant",
      { name: "variant", handlers: [handleVariantSelect], errorScope: "interaction" },
    ],
    [
      "worktree",
      {
        name: "worktree",
        handlers: [
          (ctx) =>
            handleWorktreeCallback(ctx, {
              ensureEventSubscription: deps.container.ensureEventSubscription,
            }),
        ],
        errorScope: "interaction",
      },
    ],
  ]);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    logger.debug(`[Bot] Received callback_query:data: ${data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      deps.container.setTelegramContext(bot, ctx.chat.id);
    }

    let errorScope: InteractionErrorScope = "interaction";

    try {
      // Pre-hooks run before prefix dispatch.
      const handledBackgroundSession = await handleBackgroundSessionOpen(ctx, {
        bot,
        ensureEventSubscription: deps.container.ensureEventSubscription,
      });
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
      clearInteractionErrorState(errorScope, "callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });
}
