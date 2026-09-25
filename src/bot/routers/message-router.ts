import type { Bot, Context } from "grammy";
import { config } from "../../config.js";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { handleTaskTextInput } from "../commands/task-command.js";
import {
  handleModelSearchTextInput,
} from "../callbacks/model-selection-callback-handler.js";
import { handleQuestionTextAnswer } from "../callbacks/question-callback-handler.js";
import { handleRenameTextAnswer } from "../callbacks/rename-callback-handler.js";
import { handleContextButtonPress } from "../menus/context-control-menu.js";
import { showAgentSelectionMenu } from "../menus/agent-selection-menu.js";
import { showModelSelectionMenu } from "../menus/model-selection-menu.js";
import { showVariantSelectionMenu } from "../menus/variant-selection-menu.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "../message-patterns.js";
import { promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { findQueuedPromptByButtonLabel } from "../keyboards/queued-prompt-button.js";
import { withdrawInboxPrompt } from "../../app/services/prompt-inbox-service.js";
import { handleDocumentMessage } from "../handlers/document-handler.js";
import { createMediaGroupAttachmentMiddleware } from "../handlers/media-group-handler.js";
import { handlePhotoMessage } from "../handlers/photo-handler.js";
import { queuePromptForMerging } from "../handlers/message-merger.js";
import { handleCatalogTextArguments } from "../handlers/text-message-handler.js";
import { handleVoiceMessage } from "../handlers/voice-handler.js";
import { unknownCommandMiddleware } from "../middleware/unknown-command.js";
import { getIncomingPrompt } from "../handlers/rich-message-handler.js";
import { handleUnsupportedMessage } from "../handlers/unsupported-message-handler.js";

interface MessageRouterDeps {
  container: AppContainer;
}

async function blockMenuWhileInteractionActive(
  ctx: Context,
  interactionManager: AppContainer["interactionManager"],
): Promise<boolean> {
  const activeInteraction = interactionManager.getSnapshot();
  if (!activeInteraction) {
    return false;
  }

  logger.debug(
    `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
  );
  await ctx.reply(t("interaction.blocked.finish_current"));
  return true;
}

export function registerMessageRouter(bot: Bot<Context>, deps: MessageRouterDeps): void {
  const { container } = deps;
  bot.on("message:text", unknownCommandMiddleware);

  bot.hears(QUEUED_PROMPT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Queued prompt button pressed: ${ctx.message?.text}`);

    if (await blockMenuWhileInteractionActive(ctx, container.interactionManager)) {
      return;
    }

    const label = ctx.message?.text;
    const queuedPrompt = label ? findQueuedPromptByButtonLabel(label) : null;

    if (queuedPrompt?.inbox) {
      const result = await withdrawInboxPrompt(queuedPrompt);
      const keyboard = container.keyboardManager.getKeyboard();
      const replyKey =
        result === "removed"
          ? "queue.removed"
          : result === "gone"
            ? "queue.not_found"
            : "bot.prompt_send_error";
      await ctx.reply(t(replyKey), keyboard ? { reply_markup: keyboard } : {});
      return;
    }

    if (queuedPrompt) {
      promptQueue.removeById(queuedPrompt.id);
      const keyboard = container.keyboardManager.getKeyboard();
      await ctx.reply(t("queue.removed"), keyboard ? { reply_markup: keyboard } : {});
      return;
    }

    // The queue was drained or cleared after Telegram rendered the keyboard the
    // user pressed. Never fall through to the prompt handler: that would send
    // the button label itself to OpenCode as a prompt.
    const keyboard = container.keyboardManager.getKeyboard();
    await ctx.reply(t("queue.not_found"), keyboard ? { reply_markup: keyboard } : {});
  });

  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, container.interactionManager)) {
        return;
      }

      await showAgentSelectionMenu(ctx, container);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, container.interactionManager)) {
        return;
      }

      await showModelSelectionMenu(ctx, container);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  bot.hears(CONTEXT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, container.interactionManager)) {
        return;
      }

      await handleContextButtonPress(ctx, container);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, container.interactionManager)) {
        return;
      }

      await showVariantSelectionMenu(ctx, container);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  const botDeps = { ...container, bot };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    container.setTelegramContext(bot, ctx.chat.id);
    await handleVoiceMessage(ctx, botDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    container.setTelegramContext(bot, ctx.chat.id);
    await handleVoiceMessage(ctx, botDeps);
  });

  bot.on(
    "message",
    createMediaGroupAttachmentMiddleware(botDeps),
  );

  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);
    container.setTelegramContext(bot, ctx.chat.id);
    await handlePhotoMessage(ctx, botDeps);
  });

  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    container.setTelegramContext(bot, ctx.chat.id);
    await handleDocumentMessage(ctx, botDeps);
  });

  bot.on("message:text", async (ctx) => {
    const input = getIncomingPrompt(ctx);
    if (!input) {
      return;
    }
    const { text } = input;

    container.setTelegramContext(bot, ctx.chat.id);

    if (text.startsWith("/")) {
      return;
    }

    if (container.questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx, container);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx, container);
    if (handledTask) {
      return;
    }

    const handledModelSearchText = await handleModelSearchTextInput(ctx, container);
    if (handledModelSearchText) {
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx, container);
    if (handledRename) {
      return;
    }

    const handledCatalogTextArgs = await handleCatalogTextArguments(ctx, botDeps);
    if (handledCatalogTextArgs) {
      return;
    }

    queuePromptForMerging(ctx, input, botDeps, config.bot.messageMergeWindowMs);

    logger.debug(
      `[Bot] message:text handler completed (merge window=${config.bot.messageMergeWindowMs}ms)`,
    );
  });

  bot.on("message", async (ctx) => {
    await handleUnsupportedMessage(ctx);
  });
}
