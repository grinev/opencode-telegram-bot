import type { Bot, Context } from "grammy";
import { config } from "../../config.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { questionManager } from "../../app/managers/question-manager.js";
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
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "../message-patterns.js";
import { handleDocumentMessage } from "../handlers/document-handler.js";
import { createMediaGroupAttachmentMiddleware } from "../handlers/media-group-handler.js";
import { handlePhotoMessage } from "../handlers/photo-handler.js";
import { queuePromptForMerging } from "../handlers/message-merger.js";
import { handleCatalogTextArguments } from "../handlers/text-message-handler.js";
import { handleVoiceMessage } from "../handlers/voice-handler.js";
import { unknownCommandMiddleware } from "../middleware/unknown-command.js";

interface MessageRouterDeps {
  ensureEventSubscription: (directory: string) => Promise<void>;
  setTelegramContext: (bot: Bot<Context>, chatId: number) => void;
}

async function blockMenuWhileInteractionActive(ctx: Context): Promise<boolean> {
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
  bot.on("message:text", unknownCommandMiddleware);

  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
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

  const voicePromptDeps = { bot, ensureEventSubscription: deps.ensureEventSubscription };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    deps.setTelegramContext(bot, ctx.chat.id);
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    deps.setTelegramContext(bot, ctx.chat.id);
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on(
    "message",
    createMediaGroupAttachmentMiddleware({
      bot,
      ensureEventSubscription: deps.ensureEventSubscription,
    }),
  );

  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);
    deps.setTelegramContext(bot, ctx.chat.id);
    await handlePhotoMessage(ctx, { bot, ensureEventSubscription: deps.ensureEventSubscription });
  });

  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    deps.setTelegramContext(bot, ctx.chat.id);
    await handleDocumentMessage(ctx, { bot, ensureEventSubscription: deps.ensureEventSubscription });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    deps.setTelegramContext(bot, ctx.chat.id);

    if (text.startsWith("/")) {
      return;
    }

    if (questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx);
    if (handledTask) {
      return;
    }

    const handledModelSearchText = await handleModelSearchTextInput(ctx);
    if (handledModelSearchText) {
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const promptDeps = { bot, ensureEventSubscription: deps.ensureEventSubscription };
    const handledCatalogTextArgs = await handleCatalogTextArguments(ctx, promptDeps);
    if (handledCatalogTextArgs) {
      return;
    }

    queuePromptForMerging(ctx, text, promptDeps, config.bot.messageMergeWindowMs);

    logger.debug(
      `[Bot] message:text handler completed (merge window=${config.bot.messageMergeWindowMs}ms)`,
    );
  });
}
