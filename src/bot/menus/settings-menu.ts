import { InlineKeyboard } from "grammy";
import {
  getCompactOutputMode,
  getSendDiffFileAttachments,
  getShowThinkingContent,
  getTtsMode,
  type TtsMode,
} from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export const SETTINGS_CALLBACK_PREFIX = "settings:";
export const SETTINGS_COMPACT_OUTPUT_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}compact_output`;
export const SETTINGS_THINKING_CONTENT_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}thinking_content`;
export const SETTINGS_DIFF_FILES_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}diff_files`;
export const SETTINGS_TTS_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}tts`;

export function formatBooleanSettingValue(enabled: boolean): string {
  return enabled ? t("settings.value.on") : t("settings.value.off");
}

export function formatTtsModeValue(mode: TtsMode): string {
  if (mode === "all") {
    return t("status.tts.all");
  }

  if (mode === "auto") {
    return t("status.tts.auto");
  }

  return t("status.tts.off");
}

export function buildSettingsMenuView(): { text: string; keyboard: InlineKeyboard } {
  const compactOutputMode = getCompactOutputMode();
  const showThinkingContent = getShowThinkingContent();
  const sendDiffFileAttachments = getSendDiffFileAttachments();
  const ttsMode = getTtsMode();
  const keyboard = new InlineKeyboard()
    .text(
      `${t("settings.compact_output.label")}: ${formatBooleanSettingValue(compactOutputMode)}`,
      SETTINGS_COMPACT_OUTPUT_CALLBACK,
    );

  if (!compactOutputMode) {
    keyboard.row().text(
      `${t("settings.thinking_content.label")}: ${formatBooleanSettingValue(showThinkingContent)}`,
      SETTINGS_THINKING_CONTENT_CALLBACK,
    );

    keyboard.row().text(
      `${t("settings.diff_files.label")}: ${formatBooleanSettingValue(sendDiffFileAttachments)}`,
      SETTINGS_DIFF_FILES_CALLBACK,
    );
  }

  keyboard
    .row()
    .text(`${t("settings.tts.label")}: ${formatTtsModeValue(ttsMode)}`, SETTINGS_TTS_CALLBACK);

  return {
    text: t("settings.menu.title"),
    keyboard,
  };
}
