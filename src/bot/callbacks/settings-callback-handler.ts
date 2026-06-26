import type { Context } from "grammy";
import { isTtsConfigured } from "../../app/services/tts-service.js";
import {
  setCompactOutputMode,
  setTtsMode,
  type TtsMode,
} from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import {
  buildCompactOutputModeMenuView,
  buildSettingsMenuView,
  buildTtsModeMenuView,
  parseCompactOutputModeValue,
  parseTtsModeValue,
  SETTINGS_BACK_CALLBACK,
  SETTINGS_CALLBACK_PREFIX,
  SETTINGS_COMPACT_OUTPUT_CALLBACK,
  SETTINGS_TTS_CALLBACK,
} from "../menus/settings-menu.js";

function getTtsSavedMessageKey(mode: TtsMode): "tts.off" | "tts.all" | "tts.auto" {
  if (mode === "all") {
    return "tts.all";
  }

  if (mode === "auto") {
    return "tts.auto";
  }

  return "tts.off";
}

export async function handleSettingsCallback(ctx: Context): Promise<boolean> {
  const callbackData = ctx.callbackQuery?.data;

  if (!callbackData?.startsWith(SETTINGS_CALLBACK_PREFIX)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
  if (!isActiveMenu) {
    return true;
  }

  try {
    if (callbackData === SETTINGS_BACK_CALLBACK) {
      const { text, keyboard } = buildSettingsMenuView();
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "settings"),
      });
      return true;
    }

    if (callbackData === SETTINGS_COMPACT_OUTPUT_CALLBACK) {
      const { text, keyboard } = buildCompactOutputModeMenuView();
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: appendInlineMenuCancelButton(keyboard, "settings"),
      });
      return true;
    }

    if (callbackData === SETTINGS_TTS_CALLBACK) {
      const { text, keyboard } = buildTtsModeMenuView();
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: appendInlineMenuCancelButton(keyboard, "settings"),
      });
      return true;
    }

    const compactOutputMode = parseCompactOutputModeValue(callbackData);
    if (compactOutputMode !== null) {
      setCompactOutputMode(compactOutputMode);
      const { text, keyboard } = buildSettingsMenuView();
      await ctx.answerCallbackQuery({ text: t("settings.saved") });
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "settings"),
      });
      return true;
    }

    const ttsMode = parseTtsModeValue(callbackData);
    if (ttsMode !== null) {
      if (ttsMode !== "off" && !isTtsConfigured()) {
        await ctx.answerCallbackQuery({ text: t("tts.not_configured"), show_alert: true });
        return true;
      }

      setTtsMode(ttsMode);
      const { text, keyboard } = buildSettingsMenuView();
      await ctx.answerCallbackQuery({ text: t(getTtsSavedMessageKey(ttsMode)) });
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "settings"),
      });
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  } catch (error) {
    logger.error("[Settings] Error handling settings callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
