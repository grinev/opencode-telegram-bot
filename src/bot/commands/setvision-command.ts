import { CommandContext, Context, InlineKeyboard } from "grammy";
import { formatModelForDisplay } from "../../app/types/model.js";
import {
  getStoredVisionModel,
} from "../../app/services/vision-model-service.js";
import { getModelSelectionLists } from "../../app/services/model-selection-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";

export const VISION_MODEL_SELECT_PREFIX = "vmodel:";
export const VISION_MODEL_CLEAR = "vmodel:clear";

export async function setvisionCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentVision = getStoredVisionModel();

    if (currentVision) {
      const displayName = formatModelForDisplay(currentVision.providerID, currentVision.modelID);
      const keyboard = new InlineKeyboard()
        .text(t("vision.change"), `${VISION_MODEL_SELECT_PREFIX}change`)
        .text(t("vision.clear"), VISION_MODEL_CLEAR);

      await replyWithInlineMenu(ctx, {
        menuKind: "vision",
        text: t("vision.current", { name: displayName }),
        keyboard,
      });
      return;
    }

    const modelLists = await getModelSelectionLists();
    const favorites = modelLists.favorites;
    const recent = modelLists.recent;

    if (favorites.length === 0 && recent.length === 0) {
      await ctx.reply(t("vision.no_models"));
      return;
    }

    const keyboard = new InlineKeyboard();
    const lines = [t("vision.select_prompt"), t("model.menu.favorites_title")];

    if (favorites.length === 0) {
      lines.push(t("model.menu.favorites_empty"));
    }

    lines.push(t("model.menu.recent_title"));

    if (recent.length === 0) {
      lines.push(t("model.menu.recent_empty"));
    }

    const addButton = (providerID: string, modelID: string, prefix: string): void => {
      const label = `${prefix} ${providerID}/${modelID}`;
      keyboard.text(label, `${VISION_MODEL_SELECT_PREFIX}${providerID}:${modelID}`).row();
    };

    favorites.forEach((model) => addButton(model.providerID, model.modelID, "⭐"));
    recent.forEach((model) => addButton(model.providerID, model.modelID, "🕘"));

    await replyWithInlineMenu(ctx, {
      menuKind: "vision",
      text: lines.join("\n"),
      keyboard,
    });
  } catch (err) {
    logger.error("[SetVision] Error showing vision model menu:", err);
    await ctx.reply(t("vision.error"));
  }
}
