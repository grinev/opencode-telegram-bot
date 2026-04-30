import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  setCurrentProjectMock: vi.fn(),
  clearSessionMock: vi.fn(),
  summaryAggregatorClearMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  pinnedClearMock: vi.fn().mockResolvedValue(undefined),
  pinnedRefreshMock: vi.fn().mockResolvedValue(undefined),
  pinnedGetLimitMock: vi.fn(() => 128000),
  keyboardInitMock: vi.fn(),
  keyboardUpdateMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  getStoredAgentMock: vi.fn(() => "code"),
  resolveProjectAgentMock: vi.fn(async (agent: string) => agent),
  getStoredModelMock: vi.fn(() => ({
    providerID: "anthropic",
    modelID: "claude-4",
    variant: "default",
  })),
  formatVariantMock: vi.fn(() => "Default"),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: [[{ text: "mock" }]] })),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  setCurrentProject: mocked.setCurrentProjectMock,
}));
vi.mock("../../../src/session/manager.js", () => ({
  clearSession: mocked.clearSessionMock,
}));
vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: { clear: mocked.summaryAggregatorClearMock },
}));
vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));
vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    clear: mocked.pinnedClearMock,
    refreshContextLimit: mocked.pinnedRefreshMock,
    getContextLimit: mocked.pinnedGetLimitMock,
  },
}));
vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitMock,
    updateContext: mocked.keyboardUpdateMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
  },
}));
vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
  resolveProjectAgent: mocked.resolveProjectAgentMock,
}));
vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));
vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantMock,
}));
vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { switchToProject } from "../../../src/bot/utils/switch-project.js";

function createCtx(chatId: number = 123): Context {
  return {
    chat: { id: chatId },
    api: { sendMessage: vi.fn() },
  } as unknown as Context;
}

const testProject = { id: "proj-1", worktree: "/home/user/my-app", name: "My App" };

describe("switch-project", () => {
  beforeEach(() => {
    mocked.pinnedClearMock.mockReset().mockResolvedValue(undefined);
    mocked.pinnedRefreshMock.mockReset().mockResolvedValue(undefined);
    mocked.pinnedGetLimitMock.mockReset().mockReturnValue(128000);
    mocked.getStoredAgentMock.mockReset().mockReturnValue("code");
    mocked.getStoredModelMock.mockReset().mockReturnValue({
      providerID: "anthropic",
      modelID: "claude-4",
      variant: "default",
    });
    mocked.formatVariantMock.mockReset().mockReturnValue("Default");
    mocked.createMainKeyboardMock.mockReset().mockReturnValue({ keyboard: [[{ text: "mock" }]] });
  });

  it("should call state-clearing functions with correct arguments", async () => {
    const ctx = createCtx();
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith(testProject);
    expect(mocked.clearSessionMock).toHaveBeenCalled();
    expect(mocked.summaryAggregatorClearMock).toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("test_reason");
  });

  it("should clear pinned message and refresh context limit", async () => {
    const ctx = createCtx();
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.pinnedClearMock).toHaveBeenCalled();
    expect(mocked.pinnedRefreshMock).toHaveBeenCalled();
    expect(mocked.pinnedGetLimitMock).toHaveBeenCalled();
  });

  it("should initialize keyboard manager when ctx.chat exists", async () => {
    const ctx = createCtx(456);
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.keyboardInitMock).toHaveBeenCalledWith(ctx.api, { chatId: 456 });
    expect(mocked.keyboardUpdateMock).toHaveBeenCalledWith(0, 128000);
  });

  it("should skip keyboard initialization when ctx.chat is undefined", async () => {
    const ctx = { api: {} } as unknown as Context;
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.keyboardInitMock).not.toHaveBeenCalled();
    expect(mocked.keyboardUpdateMock).toHaveBeenCalledWith(0, 128000);
  });

  it("should return keyboard from createMainKeyboard", async () => {
    const ctx = createCtx();
    const result = await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.createMainKeyboardMock).toHaveBeenCalled();
    expect(result).toEqual({ keyboard: [[{ text: "mock" }]] });
  });

  it("should pass model variant to formatVariantForButton", async () => {
    const ctx = createCtx();
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.formatVariantMock).toHaveBeenCalledWith("default");
  });

  it("should use 'default' when model variant is undefined", async () => {
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: undefined,
    });
    const ctx = createCtx();
    await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.formatVariantMock).toHaveBeenCalledWith("default");
  });

  it("should not throw if pinnedMessageManager.clear rejects", async () => {
    mocked.pinnedClearMock.mockRejectedValue(new Error("unpin failed"));
    const ctx = createCtx();

    const result = await switchToProject(ctx, testProject, "test_reason");

    expect(mocked.createMainKeyboardMock).toHaveBeenCalled();
    expect(result).toEqual({ keyboard: [[{ text: "mock" }]] });
  });
});
