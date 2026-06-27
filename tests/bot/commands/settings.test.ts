import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { settingsCommand } from "../../../src/bot/commands/settings-command.js";
import { handleSettingsCallback } from "../../../src/bot/callbacks/settings-callback-handler.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { t } from "../../../src/i18n/index.js";
import {
  SETTINGS_ASSISTANT_FOOTER_CALLBACK,
  SETTINGS_CALLBACK_PREFIX,
  SETTINGS_COMPACT_OUTPUT_CALLBACK,
  SETTINGS_DIFF_FILES_CALLBACK,
  SETTINGS_RESPONSE_STREAMING_CALLBACK,
  SETTINGS_THINKING_CONTENT_CALLBACK,
  SETTINGS_TTS_CALLBACK,
} from "../../../src/bot/menus/settings-menu.js";

const mocked = vi.hoisted(() => ({
  getCompactOutputModeMock: vi.fn(),
  setCompactOutputModeMock: vi.fn(),
  getResponseStreamingModeMock: vi.fn(),
  setResponseStreamingModeMock: vi.fn(),
  getSendDiffFileAttachmentsMock: vi.fn(),
  setSendDiffFileAttachmentsMock: vi.fn(),
  getShowThinkingContentMock: vi.fn(),
  setShowThinkingContentMock: vi.fn(),
  getShowAssistantRunFooterMock: vi.fn(),
  setShowAssistantRunFooterMock: vi.fn(),
  getTtsModeMock: vi.fn(),
  setTtsModeMock: vi.fn(),
  isTtsConfiguredMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCompactOutputMode: mocked.getCompactOutputModeMock,
  setCompactOutputMode: mocked.setCompactOutputModeMock,
  getResponseStreamingMode: mocked.getResponseStreamingModeMock,
  setResponseStreamingMode: mocked.setResponseStreamingModeMock,
  getSendDiffFileAttachments: mocked.getSendDiffFileAttachmentsMock,
  setSendDiffFileAttachments: mocked.setSendDiffFileAttachmentsMock,
  getShowThinkingContent: mocked.getShowThinkingContentMock,
  setShowThinkingContent: mocked.setShowThinkingContentMock,
  getShowAssistantRunFooter: mocked.getShowAssistantRunFooterMock,
  setShowAssistantRunFooter: mocked.setShowAssistantRunFooterMock,
  getTtsMode: mocked.getTtsModeMock,
  setTtsMode: mocked.setTtsModeMock,
}));

vi.mock("../../../src/app/services/tts-service.js", () => ({
  isTtsConfigured: mocked.isTtsConfiguredMock,
}));

describe("bot/commands/settings-command", () => {
  beforeEach(() => {
    mocked.getCompactOutputModeMock.mockReset();
    mocked.setCompactOutputModeMock.mockReset();
    mocked.getResponseStreamingModeMock.mockReset();
    mocked.setResponseStreamingModeMock.mockReset();
    mocked.getSendDiffFileAttachmentsMock.mockReset();
    mocked.setSendDiffFileAttachmentsMock.mockReset();
    mocked.getShowThinkingContentMock.mockReset();
    mocked.setShowThinkingContentMock.mockReset();
    mocked.getShowAssistantRunFooterMock.mockReset();
    mocked.setShowAssistantRunFooterMock.mockReset();
    mocked.getTtsModeMock.mockReset();
    mocked.setTtsModeMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
    mocked.getResponseStreamingModeMock.mockReturnValue("edit");
    mocked.getSendDiffFileAttachmentsMock.mockReturnValue(true);
    mocked.getShowAssistantRunFooterMock.mockReturnValue(true);
    interactionManager.clear("settings_test_reset");
  });

  it("shows settings menu with current compact output and TTS modes", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(true);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("auto");
    const replyMock = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/settings" },
      reply: replyMock,
    } as unknown as Context;

    await settingsCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledTimes(1);
    const [text, opts] = replyMock.mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts.reply_markup.inline_keyboard[0][0].text).toBe(
      `${t("settings.compact_output.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[1][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.edit")}`,
    );
    expect(opts.reply_markup.inline_keyboard[2][0].text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.auto")}`,
    );
    expect(opts.reply_markup.inline_keyboard[4][0].text).toBe(t("inline.button.close"));
  });

  it("shows thinking content setting when compact output is disabled", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    const replyMock = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/settings" },
      reply: replyMock,
    } as unknown as Context;

    await settingsCommand(ctx as never);

    const [, opts] = replyMock.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard[1][0].text).toBe(
      `${t("settings.thinking_content.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[2][0].text).toBe(
      `${t("settings.diff_files.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.edit")}`,
    );
    expect(opts.reply_markup.inline_keyboard[4][0].text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[5][0].text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.off")}`,
    );
  });

  it("marks draft response streaming mode as experimental", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getResponseStreamingModeMock.mockReturnValue("draft");
    mocked.getTtsModeMock.mockReturnValue("off");
    const replyMock = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/settings" },
      reply: replyMock,
    } as unknown as Context;

    await settingsCommand(ctx as never);

    const [, opts] = replyMock.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.draft")}`,
    );
  });
});

describe("bot/callbacks/settings-callback-handler", () => {
  beforeEach(() => {
    mocked.getCompactOutputModeMock.mockReset();
    mocked.setCompactOutputModeMock.mockReset();
    mocked.getResponseStreamingModeMock.mockReset();
    mocked.setResponseStreamingModeMock.mockReset();
    mocked.getSendDiffFileAttachmentsMock.mockReset();
    mocked.setSendDiffFileAttachmentsMock.mockReset();
    mocked.getShowThinkingContentMock.mockReset();
    mocked.setShowThinkingContentMock.mockReset();
    mocked.getShowAssistantRunFooterMock.mockReset();
    mocked.setShowAssistantRunFooterMock.mockReset();
    mocked.getTtsModeMock.mockReset();
    mocked.setTtsModeMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
    mocked.getResponseStreamingModeMock.mockReturnValue("edit");
    mocked.getSendDiffFileAttachmentsMock.mockReturnValue(true);
    mocked.getShowAssistantRunFooterMock.mockReturnValue(true);
    interactionManager.clear("settings_test_reset");
  });

  function activateSettingsMenu(): void {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "settings",
        messageId: 10,
      },
    });
  }

  function createCallbackContext(data: string): Context {
    return {
      callbackQuery: { data, message: { message_id: 10 } },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    } as unknown as Context;
  }

  it("toggles compact output mode and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_COMPACT_OUTPUT_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setCompactOutputModeMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[0][0].text).toBe(
      `${t("settings.compact_output.label")}: ${t("settings.value.on")}`,
    );
    expect(opts?.reply_markup.inline_keyboard[1][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.edit")}`,
    );
    expect(opts?.reply_markup.inline_keyboard[2][0].text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.on")}`,
    );
    expect(opts?.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.off")}`,
    );
  });

  it("toggles thinking content and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_THINKING_CONTENT_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setShowThinkingContentMock).toHaveBeenCalledWith(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[1][0].text).toBe(
      `${t("settings.thinking_content.label")}: ${t("settings.value.off")}`,
    );
  });

  it("toggles diff file attachments and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getSendDiffFileAttachmentsMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_DIFF_FILES_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setSendDiffFileAttachmentsMock).toHaveBeenCalledWith(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[2][0].text).toBe(
      `${t("settings.diff_files.label")}: ${t("settings.value.off")}`,
    );
  });

  it("toggles response streaming mode and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getResponseStreamingModeMock.mockReturnValueOnce("edit").mockReturnValueOnce("draft");
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_RESPONSE_STREAMING_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setResponseStreamingModeMock).toHaveBeenCalledWith("draft");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.draft")}`,
    );
  });

  it("toggles assistant footer and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getShowAssistantRunFooterMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_ASSISTANT_FOOTER_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setShowAssistantRunFooterMock).toHaveBeenCalledWith(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[4][0].text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.off")}`,
    );
  });

  it("cycles TTS mode and returns to settings menu", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValueOnce("off").mockReturnValueOnce("all");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_TTS_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("all");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("tts.all") });
    const [text, opts] = vi.mocked(ctx.editMessageText).mock.calls[0];
    expect(text).toBe(t("settings.menu.title"));
    expect(opts?.reply_markup.inline_keyboard[5][0].text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.all")}`,
    );
  });

  it("shows alert when TTS is not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_TTS_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("tts.not_configured"),
      show_alert: true,
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("allows cycling TTS to off when TTS is not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValueOnce("auto").mockReturnValueOnce("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_TTS_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("off");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("tts.off") });
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated callbacks", async () => {
    const ctx = createCallbackContext("unknown:data");

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("handles unknown settings callbacks", async () => {
    activateSettingsMenu();
    const ctx = createCallbackContext(`${SETTINGS_CALLBACK_PREFIX}unknown`);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("callback.processing_error") });
  });
});
