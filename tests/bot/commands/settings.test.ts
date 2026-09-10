import { beforeEach, describe, expect, it, vi } from "#vitest";
import { mock as bunMock } from "bun:test";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { defined } from "#helpers/defined.js";

// Pre-load the real module at module scope so it's cached by Bun. The mock
// factory then returns a plain object mixing real exports with mocked fns.
import * as _realSettingsStore from "../../../src/app/stores/settings-store.js";

const mocked = {
  getCompactOutputModeMock: vi.fn(),
  setCompactOutputModeMock: vi.fn(),
  getDeleteCompactProgressOnFinishMock: vi.fn(),
  setDeleteCompactProgressOnFinishMock: vi.fn(),
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
  getPromptQueueEnabledMock: vi.fn(),
  setPromptQueueEnabledMock: vi.fn(),
  isTtsConfiguredMock: vi.fn(),
};

// mock.module factory must be SYNC — Bun evaluates it synchronously.
bunMock.module("#src/app/stores/settings-store.ts", () => ({
  __resetSettingsForTests: _realSettingsStore.__resetSettingsForTests,
  clearCurrentAgent: _realSettingsStore.clearCurrentAgent,
  clearCurrentModel: _realSettingsStore.clearCurrentModel,
  clearPinnedMessageId: _realSettingsStore.clearPinnedMessageId,
  clearProject: _realSettingsStore.clearProject,
  clearSession: _realSettingsStore.clearSession,
  clearSessionDirectoryCache: _realSettingsStore.clearSessionDirectoryCache,
  getCompactOutputMode: mocked.getCompactOutputModeMock,
  getCurrentAgent: _realSettingsStore.getCurrentAgent,
  getDeleteCompactProgressOnFinish: mocked.getDeleteCompactProgressOnFinishMock,
  getCurrentModel: _realSettingsStore.getCurrentModel,
  getCurrentProject: _realSettingsStore.getCurrentProject,
  getCurrentSession: _realSettingsStore.getCurrentSession,
  getPinnedMessageId: _realSettingsStore.getPinnedMessageId,
  getResponseStreamingMode: mocked.getResponseStreamingModeMock,
  getScheduledTaskSessionIgnores: _realSettingsStore.getScheduledTaskSessionIgnores,
  getScheduledTasks: _realSettingsStore.getScheduledTasks,
  getSendDiffFileAttachments: mocked.getSendDiffFileAttachmentsMock,
  getSessionDirectoryCache: _realSettingsStore.getSessionDirectoryCache,
  getShowAssistantRunFooter: mocked.getShowAssistantRunFooterMock,
  getShowThinkingContent: mocked.getShowThinkingContentMock,
  getTtsMode: mocked.getTtsModeMock,
  getPromptQueueEnabled: mocked.getPromptQueueEnabledMock,
  getVisibleProjects: _realSettingsStore.getVisibleProjects,
  loadSettings: _realSettingsStore.loadSettings,
  setCompactOutputMode: mocked.setCompactOutputModeMock,
  setCurrentAgent: _realSettingsStore.setCurrentAgent,
  setCurrentModel: _realSettingsStore.setCurrentModel,
  setCurrentProject: _realSettingsStore.setCurrentProject,
  setCurrentSession: _realSettingsStore.setCurrentSession,
  setDeleteCompactProgressOnFinish: mocked.setDeleteCompactProgressOnFinishMock,
  setPinnedMessageId: _realSettingsStore.setPinnedMessageId,
  setPromptQueueEnabled: mocked.setPromptQueueEnabledMock,
  setResponseStreamingMode: mocked.setResponseStreamingModeMock,
  setScheduledTaskSessionIgnores: _realSettingsStore.setScheduledTaskSessionIgnores,
  setScheduledTasks: _realSettingsStore.setScheduledTasks,
  setSendDiffFileAttachments: mocked.setSendDiffFileAttachmentsMock,
  setSessionDirectoryCache: _realSettingsStore.setSessionDirectoryCache,
  setShowAssistantRunFooter: mocked.setShowAssistantRunFooterMock,
  setShowThinkingContent: mocked.setShowThinkingContentMock,
  setTtsMode: mocked.setTtsModeMock,
  setVisibleProjects: _realSettingsStore.setVisibleProjects,
}));

bunMock.module("#src/app/services/tts-service.ts", () => ({
  isTtsConfigured: mocked.isTtsConfiguredMock,
}));

// Dynamic imports — must happen AFTER mock.module calls.
const { settingsCommand } = await loadSut<typeof import("#src/bot/commands/settings-command.js")>(
  "#src/bot/commands/settings-command.ts",
  import.meta.url,
);
const { handleSettingsCallback } = await loadSut<typeof import("#src/bot/callbacks/settings-callback-handler.js")>(
  "#src/bot/callbacks/settings-callback-handler.ts",
  import.meta.url,
);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);
const {
  SETTINGS_ASSISTANT_FOOTER_CALLBACK,
  SETTINGS_CALLBACK_PREFIX,
  SETTINGS_COMPACT_OUTPUT_CALLBACK,
  SETTINGS_DELETE_PROGRESS_ON_FINISH_CALLBACK,
  SETTINGS_DIFF_FILES_CALLBACK,
  SETTINGS_PROMPT_QUEUE_CALLBACK,
  SETTINGS_RESPONSE_STREAMING_CALLBACK,
  SETTINGS_THINKING_CONTENT_CALLBACK,
  SETTINGS_TTS_CALLBACK,
} = await loadSut<typeof import("#src/bot/menus/settings-menu.js")>(
  "#src/bot/menus/settings-menu.ts",
  import.meta.url,
);

describe("bot/commands/settings-command", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((m) => m.mockReset());
    mocked.getResponseStreamingModeMock.mockReturnValue("edit");
    mocked.getSendDiffFileAttachmentsMock.mockReturnValue(true);
    mocked.getShowAssistantRunFooterMock.mockReturnValue(true);
    mocked.getPromptQueueEnabledMock.mockReturnValue(false);
    interactionManager.clear("settings_test_reset");
  });

  it("shows settings menu with current compact output and TTS modes", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(true);
    mocked.getDeleteCompactProgressOnFinishMock.mockReturnValue(true);
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
    const call = defined(replyMock.mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(opts.reply_markup.inline_keyboard[0][0].text).toBe(
      `${t("settings.compact_output.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[1][0].text).toBe(
      `${t("settings.delete_progress_on_finish.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[2][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.edit")}`,
    );
    expect(opts.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.on")}`,
    );
    expect(opts.reply_markup.inline_keyboard[4][0].text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.auto")}`,
    );
    expect(opts.reply_markup.inline_keyboard[5][0].text).toBe(
      `${t("settings.prompt_queue.label")}: ${t("settings.value.off")}`,
    );
    expect(opts.reply_markup.inline_keyboard[6][0].text).toBe(t("inline.button.close"));
  });

  it("shows thinking content setting when compact output is disabled", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getDeleteCompactProgressOnFinishMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    const replyMock = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/settings" },
      reply: replyMock,
    } as unknown as Context;

    await settingsCommand(ctx as never);

    const call = defined(replyMock.mock.calls[0]);
    const [, opts] = call;
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
    expect(opts.reply_markup.inline_keyboard[6][0].text).toBe(
      `${t("settings.prompt_queue.label")}: ${t("settings.value.off")}`,
    );
  });

  it("marks draft response streaming mode as experimental", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getDeleteCompactProgressOnFinishMock.mockReturnValue(false);
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

    const call = defined(replyMock.mock.calls[0]);
    const [, opts] = call;
    expect(opts.reply_markup.inline_keyboard[3][0].text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.draft")}`,
    );
  });
});

describe("bot/callbacks/settings-callback-handler", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((m) => m.mockReset());
    mocked.getResponseStreamingModeMock.mockReturnValue("edit");
    mocked.getSendDiffFileAttachmentsMock.mockReturnValue(true);
    mocked.getShowAssistantRunFooterMock.mockReturnValue(true);
    mocked.getPromptQueueEnabledMock.mockReturnValue(false);
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
    mocked.getDeleteCompactProgressOnFinishMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_COMPACT_OUTPUT_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setCompactOutputModeMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[0]?.[0]).text).toBe(
      `${t("settings.compact_output.label")}: ${t("settings.value.on")}`,
    );
    expect(defined(opts?.reply_markup?.inline_keyboard[1]?.[0]).text).toBe(
      `${t("settings.delete_progress_on_finish.label")}: ${t("settings.value.off")}`,
    );
    expect(defined(opts?.reply_markup?.inline_keyboard[2]?.[0]).text).toBe(
      `${t("settings.response_streaming.label")}: ${t("settings.response_streaming.edit")}`,
    );
    expect(defined(opts?.reply_markup?.inline_keyboard[3]?.[0]).text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.on")}`,
    );
    expect(defined(opts?.reply_markup?.inline_keyboard[4]?.[0]).text).toBe(
      `${t("settings.tts.label")}: ${t("status.tts.off")}`,
    );
  });

  it("toggles delete progress on finish and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(true);
    mocked.getDeleteCompactProgressOnFinishMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_DELETE_PROGRESS_ON_FINISH_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setDeleteCompactProgressOnFinishMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[1]?.[0]).text).toBe(
      `${t("settings.delete_progress_on_finish.label")}: ${t("settings.value.on")}`,
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
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[1]?.[0]).text).toBe(
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
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[2]?.[0]).text).toBe(
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
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[3]?.[0]).text).toBe(
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
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[4]?.[0]).text).toBe(
      `${t("settings.assistant_footer.label")}: ${t("settings.value.off")}`,
    );
  });

  it("toggles the prompt queue setting and returns to settings menu", async () => {
    mocked.getCompactOutputModeMock.mockReturnValue(false);
    mocked.getShowThinkingContentMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    mocked.getPromptQueueEnabledMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
    activateSettingsMenu();
    const ctx = createCallbackContext(SETTINGS_PROMPT_QUEUE_CALLBACK);

    const result = await handleSettingsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setPromptQueueEnabledMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.saved") });
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[6]?.[0]).text).toBe(
      `${t("settings.prompt_queue.label")}: ${t("settings.value.on")}`,
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
    const call = defined(vi.mocked(ctx.editMessageText).mock.calls[0]);
    const [text, opts] = call;
    expect(text).toBe(t("settings.menu.title"));
    expect(defined(opts?.reply_markup?.inline_keyboard[5]?.[0]).text).toBe(
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
