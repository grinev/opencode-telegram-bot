import { InlineKeyboard } from "grammy";
import {
  getCompactOutputMode,
  getResponseStreamingMode,
  getSendDiffFileAttachments,
  getShowAssistantRunFooter,
  getShowThinkingContent,
  getTtsMode,
  type ResponseStreamingMode,
  type TtsMode,
} from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export const SETTINGS_CALLBACK_PREFIX = "settings:";
export const SETTINGS_COMPACT_OUTPUT_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}compact_output`;
export const SETTINGS_THINKING_CONTENT_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}thinking_content`;
export const SETTINGS_RESPONSE_STREAMING_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}response_streaming`;
export const SETTINGS_DIFF_FILES_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}diff_files`;
export const SETTINGS_ASSISTANT_FOOTER_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}assistant_footer`;
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

export function formatResponseStreamingModeValue(mode: ResponseStreamingMode): string {
  return mode === "draft"
    ? t("settings.response_streaming.draft")
    : t("settings.response_streaming.edit");
}

export function buildSettingsMenuView(): { text: string; keyboard: InlineKeyboard } {
  const compactOutputMode = getCompactOutputMode();
  const showThinkingContent = getShowThinkingContent();
  const responseStreamingMode = getResponseStreamingMode();
  const sendDiffFileAttachments = getSendDiffFileAttachments();
  const showAssistantRunFooter = getShowAssistantRunFooter();
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
    .text(
      `${t("settings.response_streaming.label")}: ${formatResponseStreamingModeValue(responseStreamingMode)}`,
      SETTINGS_RESPONSE_STREAMING_CALLBACK,
    )
    .row()
    .text(
      `${t("settings.assistant_footer.label")}: ${formatBooleanSettingValue(showAssistantRunFooter)}`,
      SETTINGS_ASSISTANT_FOOTER_CALLBACK,
    )
    .row()
    .text(`${t("settings.tts.label")}: ${formatTtsModeValue(ttsMode)}`, SETTINGS_TTS_CALLBACK);

  return {
    text: t("settings.menu.title"),
    keyboard,
  };
}
