import { Context } from "grammy";
import { formatModelForDisplay } from "../../app/types/model.js";
import type { ModelInfo } from "../../app/types/model.js";
import {
  setVisionModel,
  clearVisionModel,
} from "../../app/services/vision-model-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { clearActiveInlineMenu } from "../menus/inline-menu.js";
import {
  VISION_MODEL_CLEAR,
  VISION_MODEL_SELECT_PREFIX,
  setvisionCommand,
} from "../commands/setvision-command.js";

export async function handleVisionModelSelect(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  if (data === VISION_MODEL_CLEAR) {
    try {
      clearVisionModel();
      clearActiveInlineMenu("vision_cleared");
      await ctx.answerCallbackQuery({ text: t("vision.cleared") });
      await ctx.reply(t("vision.model_cleared"));
      await ctx.deleteMessage().catch(() => {});
    } catch (err) {
      clearActiveInlineMenu("vision_clear_error");
      logger.error("[VisionModel] Error clearing vision model:", err);
      await ctx.answerCallbackQuery({ text: t("vision.error") });
    }
    return true;
  }

  if (data === `${VISION_MODEL_SELECT_PREFIX}change`) {
    try {
      clearVisionModel();
      clearActiveInlineMenu("vision_change");
      await ctx.deleteMessage().catch(() => {});
      await setvisionCommand(ctx as never);
    } catch (err) {
      clearActiveInlineMenu("vision_change_error");
      logger.error("[VisionModel] Error switching to change menu:", err);
      await ctx.answerCallbackQuery({ text: t("vision.error") });
    }
    return true;
  }

  if (data.startsWith(VISION_MODEL_SELECT_PREFIX)) {
    const idPart = data.slice(VISION_MODEL_SELECT_PREFIX.length);
    const separatorIndex = idPart.indexOf(":");
    if (separatorIndex === -1) {
      return false;
    }

    const providerID = idPart.slice(0, separatorIndex);
    const modelID = idPart.slice(separatorIndex + 1);

    if (!providerID || !modelID) {
      return false;
    }

    try {
      const modelInfo: ModelInfo = { providerID, modelID };
      setVisionModel(modelInfo);
      clearActiveInlineMenu("vision_model_selected");

      const displayName = formatModelForDisplay(providerID, modelID);
      await ctx.answerCallbackQuery({ text: t("vision.model_set") });
      await ctx.reply(t("vision.model_set_message", { name: displayName }));
      await ctx.deleteMessage().catch(() => {});
    } catch (err) {
      clearActiveInlineMenu("vision_model_select_error");
      logger.error("[VisionModel] Error setting vision model:", err);
      await ctx.answerCallbackQuery({ text: t("vision.error") });
    }
    return true;
  }

  return false;
}
