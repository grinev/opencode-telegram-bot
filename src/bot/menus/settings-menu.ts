import { InlineKeyboard } from "grammy";
import {
  getCompactOutputMode,
  getTtsMode,
  type TtsMode,
} from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export const SETTINGS_CALLBACK_PREFIX = "settings:";
export const SETTINGS_BACK_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}back`;
export const SETTINGS_COMPACT_OUTPUT_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}compact_output`;
export const SETTINGS_TTS_CALLBACK = `${SETTINGS_CALLBACK_PREFIX}tts`;

const SETTINGS_COMPACT_OUTPUT_VALUE_PREFIX = `${SETTINGS_COMPACT_OUTPUT_CALLBACK}:`;
const SETTINGS_TTS_VALUE_PREFIX = `${SETTINGS_TTS_CALLBACK}:`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatCompactOutputModeValue(enabled: boolean): string {
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
  const ttsMode = getTtsMode();
  const keyboard = new InlineKeyboard()
    .text(
      `${t("settings.compact_output.label")}: ${formatCompactOutputModeValue(compactOutputMode)}`,
      SETTINGS_COMPACT_OUTPUT_CALLBACK,
    )
    .row()
    .text(`${t("settings.tts.label")}: ${formatTtsModeValue(ttsMode)}`, SETTINGS_TTS_CALLBACK);

  return {
    text: t("settings.menu.title"),
    keyboard,
  };
}

export function buildCompactOutputModeMenuView(): { text: string; keyboard: InlineKeyboard } {
  const compactOutputMode = getCompactOutputMode();
  const keyboard = new InlineKeyboard()
    .text(
      `${compactOutputMode ? "" : "✅ "}${t("settings.value.off")}`,
      `${SETTINGS_COMPACT_OUTPUT_VALUE_PREFIX}off`,
    )
    .row()
    .text(
      `${compactOutputMode ? "✅ " : ""}${t("settings.value.on")}`,
      `${SETTINGS_COMPACT_OUTPUT_VALUE_PREFIX}on`,
    )
    .row()
    .text(t("settings.button.back"), SETTINGS_BACK_CALLBACK);

  return {
    text: `${t("settings.menu.title")}\n\n<b>${escapeHtml(t("settings.compact_output.label"))}</b>`,
    keyboard,
  };
}

export function buildTtsModeMenuView(): { text: string; keyboard: InlineKeyboard } {
  const current = getTtsMode();
  const keyboard = new InlineKeyboard()
    .text(
      `${current === "off" ? "✅ " : ""}🔇 ${t("status.tts.off")}`,
      `${SETTINGS_TTS_VALUE_PREFIX}off`,
    )
    .row()
    .text(
      `${current === "all" ? "✅ " : ""}🔊 ${t("status.tts.all")}`,
      `${SETTINGS_TTS_VALUE_PREFIX}all`,
    )
    .row()
    .text(
      `${current === "auto" ? "✅ " : ""}🎤 ${t("status.tts.auto")}`,
      `${SETTINGS_TTS_VALUE_PREFIX}auto`,
    )
    .row()
    .text(t("settings.button.back"), SETTINGS_BACK_CALLBACK);

  return {
    text: `${t("settings.menu.title")}\n\n<b>${escapeHtml(t("settings.tts.title"))}</b>`,
    keyboard,
  };
}

export function parseCompactOutputModeValue(callbackData: string): boolean | null {
  if (!callbackData.startsWith(SETTINGS_COMPACT_OUTPUT_VALUE_PREFIX)) {
    return null;
  }

  const value = callbackData.slice(SETTINGS_COMPACT_OUTPUT_VALUE_PREFIX.length);
  if (value === "on") {
    return true;
  }

  if (value === "off") {
    return false;
  }

  return null;
}

export function parseTtsModeValue(callbackData: string): TtsMode | null {
  if (!callbackData.startsWith(SETTINGS_TTS_VALUE_PREFIX)) {
    return null;
  }

  const value = callbackData.slice(SETTINGS_TTS_VALUE_PREFIX.length);
  if (value === "off" || value === "all" || value === "auto") {
    return value;
  }

  return null;
}
