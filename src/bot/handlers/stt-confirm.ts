import { Context, InlineKeyboard } from "grammy";
import type { ProcessPromptDeps } from "./prompt.js";
import { processUserPrompt } from "./prompt.js";
import { interactionManager } from "../../interaction/manager.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const STT_CONFIRM_EXPIRES_MS = 5 * 60 * 1000;

function buildSttConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("stt.confirm_send"), "stt:send")
    .text(t("stt.confirm_edit"), "stt:edit")
    .text(t("stt.confirm_cancel"), "stt:cancel");
}

export async function showSttConfirmation(
  ctx: Context,
  statusMessageId: number,
  recognizedText: string,
): Promise<void> {
  const keyboard = buildSttConfirmKeyboard();

  interactionManager.start({
    kind: "custom",
    expectedInput: "callback",
    allowedCommands: [],
    metadata: {
      sttTranscript: recognizedText,
      statusMessageId,
    },
    expiresInMs: STT_CONFIRM_EXPIRES_MS,
  });

  await ctx.api.editMessageText(
    ctx.chat!.id,
    statusMessageId,
    t("stt.confirm_message", { text: recognizedText }),
    { reply_markup: keyboard },
  );
}

export async function handleSttConfirmCallback(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("stt:")) {
    return false;
  }

  const interaction = interactionManager.getSnapshot();
  if (!interaction || interaction.kind !== "custom" || !interaction.metadata?.sttTranscript) {
    await ctx.answerCallbackQuery({ text: t("stt.confirm_inactive") });
    return true;
  }

  const action = data.slice(4);
  const transcript = interaction.metadata.sttTranscript as string;
  const statusMessageId = interaction.metadata.statusMessageId as number;
  const chatId = ctx.chat!.id;

  switch (action) {
    case "send": {
      await ctx.answerCallbackQuery();

      try {
        await ctx.api.editMessageText(
          chatId,
          statusMessageId,
          t("stt.confirm_sending"),
        );
      } catch (err) {
        logger.warn("[STT] Failed to edit status message on send:", err);
      }

      interactionManager.clear("stt_sent");

      let textForLLM = transcript;
      const notePrompt = config.stt.notePrompt.trim();
      if (notePrompt && notePrompt.toLowerCase() !== "false" && notePrompt !== "0") {
        textForLLM = `[Note: ${notePrompt}]\n${transcript}`;
      }

      await processUserPrompt(ctx, textForLLM, deps);
      return true;
    }

    case "edit": {
      await ctx.answerCallbackQuery();

      interactionManager.transition({
        expectedInput: "mixed",
        metadata: { sttTranscript: transcript, statusMessageId },
        allowedCommands: [],
      });

      try {
        await ctx.api.editMessageText(
          chatId,
          statusMessageId,
          t("stt.confirm_edit_prompt"),
        );
      } catch (err) {
        logger.warn("[STT] Failed to edit message on edit:", err);
      }

      return true;
    }

    case "cancel": {
      await ctx.answerCallbackQuery();

      interactionManager.clear("stt_cancelled");

      try {
        await ctx.api.editMessageText(
          chatId,
          statusMessageId,
          t("stt.confirm_cancelled"),
        );
      } catch (err) {
        logger.warn("[STT] Failed to edit message on cancel:", err);
      }

      return true;
    }

    default:
      await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      return true;
  }
}

export async function handleSttEditText(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  const interaction = interactionManager.getSnapshot();
  if (
    !interaction ||
    interaction.kind !== "custom" ||
    (interaction.expectedInput !== "text" && interaction.expectedInput !== "mixed") ||
    !interaction.metadata?.sttTranscript
  ) {
    return false;
  }

  const originalTranscript = interaction.metadata.sttTranscript as string;
  const statusMessageId = interaction.metadata.statusMessageId as number;
  const chatId = ctx.chat!.id;

  interactionManager.clear("stt_edit_sent");

  try {
    await ctx.api.editMessageText(
      chatId,
      statusMessageId,
      t("stt.confirm_edit_sending"),
    );
  } catch (err) {
    logger.warn("[STT] Failed to edit status message on edit text:", err);
  }

  let textForLLM = text;
  const notePrompt = config.stt.notePrompt.trim();
  if (notePrompt && notePrompt.toLowerCase() !== "false" && notePrompt !== "0") {
    textForLLM = `[Note: ${notePrompt}]\n${text}`;
  }

  logger.info(
    `[STT] Edit flow: original="${originalTranscript.slice(0, 100)}", edited="${text.slice(0, 100)}"`,
  );

  await processUserPrompt(ctx, textForLLM, deps);
  return true;
}
