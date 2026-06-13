import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  clearAllInteractionState: vi.fn(),
  handleAgentSelect: vi.fn(),
  handleCommandsCallback: vi.fn(),
  handleCompactConfirm: vi.fn(),
  handleLsCallback: vi.fn(),
  handleOpenCallback: vi.fn(),
  handleInlineMenuCancel: vi.fn(),
  handleMcpsCallback: vi.fn(),
  handleMessagesCallback: vi.fn(),
  handleModelSearchCallback: vi.fn(),
  handleModelSearchResults: vi.fn(),
  handleModelSelect: vi.fn(),
  handlePermissionCallback: vi.fn(),
  handleProjectSelect: vi.fn(),
  handleQuestionCallback: vi.fn(),
  handleRenameCancel: vi.fn(),
  handleBackgroundSessionOpen: vi.fn(),
  handleSessionSelect: vi.fn(),
  handleSkillsCallback: vi.fn(),
  handleTaskCallback: vi.fn(),
  handleTaskListCallback: vi.fn(),
  handleVariantSelect: vi.fn(),
  handleWorktreeCallback: vi.fn(),
  clearLsPathIndex: vi.fn(),
  clearOpenPathIndex: vi.fn(),
}));

vi.mock("../../../src/app/managers/interaction-manager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/managers/interaction-manager.js")>()),
  clearAllInteractionState: mocked.clearAllInteractionState,
}));
vi.mock("../../../src/i18n/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/i18n/index.js")>()),
  t: (key: string) => key,
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
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

const allHandlers = [
  mocked.handleAgentSelect,
  mocked.handleCommandsCallback,
  mocked.handleCompactConfirm,
  mocked.handleLsCallback,
  mocked.handleOpenCallback,
  mocked.handleInlineMenuCancel,
  mocked.handleMcpsCallback,
  mocked.handleMessagesCallback,
  mocked.handleModelSearchCallback,
  mocked.handleModelSearchResults,
  mocked.handleModelSelect,
  mocked.handlePermissionCallback,
  mocked.handleProjectSelect,
  mocked.handleQuestionCallback,
  mocked.handleRenameCancel,
  mocked.handleBackgroundSessionOpen,
  mocked.handleSessionSelect,
  mocked.handleSkillsCallback,
  mocked.handleTaskCallback,
  mocked.handleTaskListCallback,
  mocked.handleVariantSelect,
  mocked.handleWorktreeCallback,
];

describe("bot/callbacks/callback-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const handler of allHandlers) {
      handler.mockResolvedValue(false);
    }
  });

  it("answers unknown callbacks", async () => {
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext();

    await callback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.unknown_command" });
  });

  it("clears interaction state when a callback handler throws", async () => {
    mocked.handleAgentSelect.mockRejectedValueOnce(new Error("boom"));
    const callback = registerAndGetCallback();
    const ctx = createCallbackContext();

    await callback(ctx);

    expect(mocked.clearAllInteractionState).toHaveBeenCalledWith("callback_handler_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "callback.processing_error" });
  });
});

function registerAndGetCallback() {
  const bot = { on: vi.fn() };
  registerCallbackRouter(bot as never, {
    ensureEventSubscription: vi.fn(),
    setTelegramContext: vi.fn(),
  });
  return bot.on.mock.calls[0][1] as (ctx: Context) => Promise<void>;
}

function createCallbackContext(): Context {
  return {
    callbackQuery: { data: "unknown" },
    from: { id: 1 },
    chat: { id: 2 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}
