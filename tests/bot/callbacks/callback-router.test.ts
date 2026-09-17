import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { defined } from "../../helpers/defined.js";

const mocked = vi.hoisted(() => ({
  resetInteractionError: vi.fn(),
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

vi.mock("../../../src/i18n/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/i18n/index.js")>()),
  t: (key: string) => key,
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/bot/callbacks/agent-selection-callback-handler.js", () => ({
  handleAgentSelect: mocked.handleAgentSelect,
}));
vi.mock("../../../src/bot/callbacks/command-catalog-callback-handler.js", () => ({
  handleCommandsCallback: mocked.handleCommandsCallback,
}));
vi.mock("../../../src/bot/callbacks/context-control-callback-handler.js", () => ({
  handleCompactConfirm: mocked.handleCompactConfirm,
}));
vi.mock("../../../src/bot/callbacks/file-browser-callback-handler.js", () => ({
  handleLsCallback: mocked.handleLsCallback,
  handleOpenCallback: mocked.handleOpenCallback,
}));
vi.mock("../../../src/bot/callbacks/inline-menu-cancel-callback-handler.js", () => ({
  handleInlineMenuCancel: mocked.handleInlineMenuCancel,
}));
vi.mock("../../../src/bot/callbacks/mcp-catalog-callback-handler.js", () => ({
  handleMcpsCallback: mocked.handleMcpsCallback,
}));
vi.mock("../../../src/bot/callbacks/message-history-callback-handler.js", () => ({
  handleMessagesCallback: mocked.handleMessagesCallback,
}));
vi.mock("../../../src/bot/callbacks/model-selection-callback-handler.js", () => ({
  handleModelProvidersCallback: mocked.handleModelProvidersCallback,
  handleModelSearchCallback: mocked.handleModelSearchCallback,
  handleModelSearchResults: mocked.handleModelSearchResults,
  handleModelSelect: mocked.handleModelSelect,
}));
vi.mock("../../../src/bot/callbacks/permission-callback-handler.js", () => ({
  handlePermissionCallback: mocked.handlePermissionCallback,
}));
vi.mock("../../../src/bot/callbacks/project-callback-handler.js", () => ({
  handleProjectSelect: mocked.handleProjectSelect,
}));
vi.mock("../../../src/bot/callbacks/prompt-attachment-callback-handler.js", () => ({
  handlePromptAttachmentCancel: mocked.handlePromptAttachmentCancel,
}));
vi.mock("../../../src/bot/callbacks/question-callback-handler.js", () => ({
  handleQuestionCallback: mocked.handleQuestionCallback,
}));
vi.mock("../../../src/bot/callbacks/rename-callback-handler.js", () => ({
  handleRenameCancel: mocked.handleRenameCancel,
}));
vi.mock("../../../src/bot/callbacks/session-callback-handler.js", () => ({
  handleBackgroundSessionOpen: mocked.handleBackgroundSessionOpen,
  handleSessionSelect: mocked.handleSessionSelect,
}));
vi.mock("../../../src/bot/callbacks/settings-callback-handler.js", () => ({
  handleSettingsCallback: mocked.handleSettingsCallback,
}));
vi.mock("../../../src/bot/callbacks/skills-catalog-callback-handler.js", () => ({
  handleSkillsCallback: mocked.handleSkillsCallback,
}));
vi.mock("../../../src/bot/callbacks/scheduled-task-callback-handler.js", () => ({
  handleTaskCallback: mocked.handleTaskCallback,
  handleTaskListCallback: mocked.handleTaskListCallback,
}));
vi.mock("../../../src/bot/callbacks/variant-selection-callback-handler.js", () => ({
  handleVariantSelect: mocked.handleVariantSelect,
}));
vi.mock("../../../src/bot/callbacks/worktree-callback-handler.js", () => ({
  handleWorktreeCallback: mocked.handleWorktreeCallback,
}));
vi.mock("../../../src/bot/menus/file-browser-menu.js", () => ({
  clearLsPathIndex: mocked.clearLsPathIndex,
  clearOpenPathIndex: mocked.clearOpenPathIndex,
}));

import { registerCallbackRouter } from "../../../src/bot/callbacks/callback-router.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

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

  it("answers callbacks with an unknown prefix", async () => {
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

    expect(mocked.resetInteractionError).toHaveBeenCalledWith(
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

    expect(mocked.resetInteractionError).toHaveBeenCalledWith(
      "permission",
      "callback_handler_error",
    );
  });

  it("does not clear state when a pre-hook throws before dispatch", async () => {
    mocked.handleBackgroundSessionOpen.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext("background-session:session-1");

    await callback(ctx);

    expect(mocked.resetInteractionError).toHaveBeenCalledWith(
      "interaction",
      "callback_handler_error",
    );
  });
});

function registerAndGetCallback() {
  const bot = { on: vi.fn() };
  registerCallbackRouter(bot as never, {
    container: createTestAppContainer({
      ensureEventSubscription: vi.fn(),
      setTelegramContext: vi.fn(),
      resetInteractionError: mocked.resetInteractionError,
    }),
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
