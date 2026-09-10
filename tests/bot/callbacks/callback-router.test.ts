import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { defined } from "#helpers/defined.js";

const mocked = vi.hoisted(() => ({
  clearInteractionErrorState: vi.fn(),
  handleAgentSelect: vi.fn(),
  handleCommandsCallback: vi.fn(),
  handleCompactConfirm: vi.fn(),
  handleLsCallback: vi.fn(),
  handleOpenCallback: vi.fn(),
  handleInlineMenuCancel: vi.fn(),
  handleMcpsCallback: vi.fn(),
  handleMessagesCallback: vi.fn(),
  handleModelProvidersCallback: vi.fn(),
  handleModelSearchCallback: vi.fn(),
  handleModelSearchResults: vi.fn(),
  handleModelSelect: vi.fn(),
  handlePermissionCallback: vi.fn(),
  handleProjectSelect: vi.fn(),
  handlePromptAttachmentCancel: vi.fn(),
  handleQuestionCallback: vi.fn(),
  handleRenameCancel: vi.fn(),
  handleBackgroundSessionOpen: vi.fn(),
  handleSessionSelect: vi.fn(),
  handleSettingsCallback: vi.fn(),
  handleSkillsCallback: vi.fn(),
  handleTaskCallback: vi.fn(),
  handleTaskListCallback: vi.fn(),
  handleVariantSelect: vi.fn(),
  handleWorktreeCallback: vi.fn(),
  clearLsPathIndex: vi.fn(),
  clearOpenPathIndex: vi.fn(),
}));

vi.mock("#src/app/managers/interaction-manager.ts", () => ({
  clearInteractionErrorState: mocked.clearInteractionErrorState,
  interactionManager: { clear: vi.fn() },
  clearAllInteractionState: mocked.clearAllInteractionState,
  DEFAULT_ALLOWED_INTERACTION_COMMANDS: ["/abort", "/detach", "/status", "/help"],
}));
vi.mock("#src/i18n/index.ts", () => ({
  t: (key: string) => key,
  SUPPORTED_LOCALES: ["en", "es"],
  getDateLocale: vi.fn(),
  getLocale: vi.fn(() => "en"),
  getLocaleOptions: vi.fn(),
  isSupportedLocale: vi.fn(() => true),
  normalizeLocale: vi.fn((l: string) => l),
  resetRuntimeLocale: vi.fn(),
  resolveSupportedLocale: vi.fn(() => "en"),
  setRuntimeLocale: vi.fn(),
}));
vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("#src/bot/callbacks/agent-selection-callback-handler.ts", () => ({
  handleAgentSelect: mocked.handleAgentSelect,
}));
vi.mock("#src/bot/callbacks/command-catalog-callback-handler.ts", () => ({
  handleCommandsCallback: mocked.handleCommandsCallback,
}));
vi.mock("#src/bot/callbacks/context-control-callback-handler.ts", () => ({
  handleCompactConfirm: mocked.handleCompactConfirm,
}));
vi.mock("#src/bot/callbacks/file-browser-callback-handler.ts", () => ({
  handleLsCallback: mocked.handleLsCallback,
  handleOpenCallback: mocked.handleOpenCallback,
}));
vi.mock("#src/bot/callbacks/inline-menu-cancel-callback-handler.ts", () => ({
  handleInlineMenuCancel: mocked.handleInlineMenuCancel,
}));
vi.mock("#src/bot/callbacks/mcp-catalog-callback-handler.ts", () => ({
  handleMcpsCallback: mocked.handleMcpsCallback,
}));
vi.mock("#src/bot/callbacks/message-history-callback-handler.ts", () => ({
  handleMessagesCallback: mocked.handleMessagesCallback,
}));
vi.mock("#src/bot/callbacks/model-selection-callback-handler.ts", () => ({
  handleModelProvidersCallback: mocked.handleModelProvidersCallback,
  handleModelSearchCallback: mocked.handleModelSearchCallback,
  handleModelSearchResults: mocked.handleModelSearchResults,
  handleModelSelect: mocked.handleModelSelect,
}));
vi.mock("#src/bot/callbacks/permission-callback-handler.ts", () => ({
  handlePermissionCallback: mocked.handlePermissionCallback,
}));
vi.mock("#src/bot/callbacks/project-callback-handler.ts", () => ({
  handleProjectSelect: mocked.handleProjectSelect,
}));
vi.mock("#src/bot/callbacks/question-callback-handler.ts", () => ({
  handleQuestionCallback: mocked.handleQuestionCallback,
}));
vi.mock("#src/bot/callbacks/rename-callback-handler.ts", () => ({
  handleRenameCancel: mocked.handleRenameCancel,
}));
vi.mock("#src/bot/callbacks/session-callback-handler.ts", () => ({
  handleBackgroundSessionOpen: mocked.handleBackgroundSessionOpen,
  handleSessionSelect: mocked.handleSessionSelect,
}));
vi.mock("#src/bot/callbacks/skills-catalog-callback-handler.ts", () => ({
  handleSkillsCallback: mocked.handleSkillsCallback,
}));
vi.mock("#src/bot/callbacks/scheduled-task-callback-handler.ts", () => ({
  handleTaskCallback: mocked.handleTaskCallback,
  handleTaskListCallback: mocked.handleTaskListCallback,
}));
vi.mock("#src/bot/callbacks/variant-selection-callback-handler.ts", () => ({
  handleVariantSelect: mocked.handleVariantSelect,
}));
vi.mock("#src/bot/callbacks/worktree-callback-handler.ts", () => ({
  handleWorktreeCallback: mocked.handleWorktreeCallback,
}));
vi.mock("#src/bot/menus/file-browser-menu.ts", () => ({
  clearLsPathIndex: mocked.clearLsPathIndex,
  clearOpenPathIndex: mocked.clearOpenPathIndex,
}));
vi.mock("#src/bot/callbacks/prompt-attachment-callback-handler.ts", () => ({
  handlePromptAttachmentCancel: mocked.handlePromptAttachmentCancel,
}));
vi.mock("#src/bot/callbacks/settings-callback-handler.ts", () => ({
  handleSettingsCallback: mocked.handleSettingsCallback,
}));

// NOTE: keep this AFTER every vi.mock above — bun only intercepts dynamic
// imports, so the SUT must be loaded once all mocks are registered.
const sut = await loadSut<typeof import("#src/bot/callbacks/callback-router.js")>(
  "#src/bot/callbacks/callback-router.ts",
  import.meta.url,
);

const tableHandlers = [
  mocked.handleAgentSelect,
  mocked.handleCommandsCallback,
  mocked.handleCompactConfirm,
  mocked.handleLsCallback,
  mocked.handleOpenCallback,
  mocked.handleMcpsCallback,
  mocked.handleMessagesCallback,
  mocked.handleModelProvidersCallback,
  mocked.handleModelSearchCallback,
  mocked.handleModelSearchResults,
  mocked.handleModelSelect,
  mocked.handlePermissionCallback,
  mocked.handleProjectSelect,
  mocked.handlePromptAttachmentCancel,
  mocked.handleQuestionCallback,
  mocked.handleRenameCancel,
  mocked.handleSessionSelect,
  mocked.handleSettingsCallback,
  mocked.handleSkillsCallback,
  mocked.handleTaskCallback,
  mocked.handleTaskListCallback,
  mocked.handleVariantSelect,
  mocked.handleWorktreeCallback,
];

describe("bot/callbacks/callback-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const handler of [
      ...tableHandlers,
      mocked.handleBackgroundSessionOpen,
      mocked.handleInlineMenuCancel,
    ]) {
      handler.mockResolvedValue(false);
    }
  });

  it("dispatches a callback only to the handler matching its prefix", async () => {
    mocked.handleAgentSelect.mockResolvedValue(true);
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("agent:subagent");

    await callback(ctx);

    expect(mocked.handleAgentSelect).toHaveBeenCalledTimes(1);
    for (const handler of tableHandlers) {
      if (handler !== mocked.handleAgentSelect) {
        expect(handler).not.toHaveBeenCalled();
      }
    }
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("does not call other handlers when the callback is handled", async () => {
    mocked.handleSettingsCallback.mockResolvedValue(true);
    const callback = registerAndGetCallback();

    await callback(createCallbackContext("settings:tts"));

    const calledHandlers = tableHandlers.filter((handler) => handler.mock.calls.length > 0);
    expect(calledHandlers).toEqual([mocked.handleSettingsCallback]);
  });

  it("runs the model handlers as a chain until one handles the callback", async () => {
    mocked.handleModelSelect.mockResolvedValue(true);
    const callback = registerAndGetCallback();

    await callback(createCallbackContext("model:anthropic:claude"));

    expect(mocked.handleModelSearchCallback).toHaveBeenCalledTimes(1);
    expect(mocked.handleModelSearchResults).toHaveBeenCalledTimes(1);
    expect(mocked.handleModelProvidersCallback).toHaveBeenCalledTimes(1);
    expect(mocked.handleModelSelect).toHaveBeenCalledTimes(1);
  });

  it("stops the model chain when an earlier handler handles the callback", async () => {
    mocked.handleModelSearchResults.mockResolvedValue(true);
    const callback = registerAndGetCallback();

    await callback(createCallbackContext("model:result:0"));

    expect(mocked.handleModelSearchCallback).toHaveBeenCalledTimes(1);
    expect(mocked.handleModelSearchResults).toHaveBeenCalledTimes(1);
    expect(mocked.handleModelProvidersCallback).not.toHaveBeenCalled();
    expect(mocked.handleModelSelect).not.toHaveBeenCalled();
  });

  it("does not call table handlers when the background session pre-hook handles the callback", async () => {
    mocked.handleBackgroundSessionOpen.mockResolvedValue(true);
    const callback = registerAndGetCallback();

    await callback(createCallbackContext("background-session:session-1"));

    for (const handler of tableHandlers) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("clears path indexes when the inline cancel pre-hook handles the callback", async () => {
    mocked.handleInlineMenuCancel.mockResolvedValue(true);
    const callback = registerAndGetCallback();

    await callback(createCallbackContext("inline:cancel:model"));

    expect(mocked.clearOpenPathIndex).toHaveBeenCalledTimes(1);
    expect(mocked.clearLsPathIndex).toHaveBeenCalledTimes(1);
    for (const handler of tableHandlers) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("answers unknown callbacks", async () => {
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext();

    await callback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.unknown_command" });
  });

  it("does not answer as unknown when the provider browser handles the callback", async () => {
    mocked.handleModelProvidersCallback.mockResolvedValue(true);
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("model:providers:0");

    await callback(ctx);

    expect(mocked.handleModelProvidersCallback).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("clears interaction state when a callback handler throws", async () => {
    mocked.handleAgentSelect.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("nonexistent:action");

    await callback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.unknown_command" });
    for (const handler of tableHandlers) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("answers callbacks without a colon as unknown", async () => {
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("noseparator");

    await callback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.unknown_command" });
  });

  it("clears the interaction scope when a callback handler throws", async () => {
    mocked.handleAgentSelect.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("agent:subagent");

    await callback(ctx);

    expect(mocked.clearInteractionErrorState).toHaveBeenCalledWith(
      "interaction",
      "callback_handler_error",
    );
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.processing_error" });
  });

  it("clears the permission scope when the permission handler throws", async () => {
    mocked.handlePermissionCallback.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("permission:req-1:allow");

    await callback(ctx);

    expect(mocked.clearInteractionErrorState).toHaveBeenCalledWith(
      "permission",
      "callback_handler_error",
    );
  });

  it("does not clear state when a pre-hook throws before dispatch", async () => {
    mocked.handleBackgroundSessionOpen.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("background-session:session-1");

    await callback(ctx);

    expect(mocked.clearInteractionErrorState).toHaveBeenCalledWith(
      "interaction",
      "callback_handler_error",
    );
  });
});

function registerAndGetCallback() {
  const bot = { on: vi.fn() };
  sut.registerCallbackRouter(bot as never, {
    ensureEventSubscription: vi.fn(),
    setTelegramContext: vi.fn(),
  });
  return defined(bot.on.mock.calls[0]?.[1]) as (ctx: Context) => Promise<void>;
}

function createCallbackContext(data = "unknown"): Context {
  return {
    callbackQuery: { data },
    from: { id: 1 },
    chat: { id: 2 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}
