import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";
import type { ModelInfo } from "../../../src/app/types/model.js";

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
  getStoredModelMock: vi.fn(
    (): ModelInfo => ({
      providerID: "anthropic",
      modelID: "claude-4",
      variant: "default",
    }),
  ),
  formatVariantMock: vi.fn(() => "Default"),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: [[{ text: "mock" }]] })),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  setCurrentProject: mocked.setCurrentProjectMock,
}));
vi.mock("../../../src/app/services/session-service.js", () => ({
  clearSession: mocked.clearSessionMock,
}));
vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
  resolveProjectAgent: mocked.resolveProjectAgentMock,
}));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));
vi.mock("../../../src/app/services/variant-selection-service.js", () => ({
  formatVariantForButton: mocked.formatVariantMock,
}));
vi.mock("../../../src/bot/keyboards/main-reply-keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { switchToProject } from "../../../src/app/services/project-switch-service.js";
import { createProjectSwitchPresentation } from "../../../src/bot/services/project-switch-presentation.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const deps = createTestAppContainer({
  resetAggregator: mocked.summaryAggregatorClearMock,
  resetInteractions: mocked.clearAllInteractionStateMock,
  pinnedMessageManager: {
    clear: mocked.pinnedClearMock,
    refreshContextLimit: mocked.pinnedRefreshMock,
    getContextLimit: mocked.pinnedGetLimitMock,
  } as unknown as AppContainer["pinnedMessageManager"],
  keyboardManager: {
    initialize: mocked.keyboardInitMock,
    updateContext: mocked.keyboardUpdateMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
  } as unknown as AppContainer["keyboardManager"],
});

function createCtx(chatId: number = 123): Context {
  return {
    chat: { id: chatId },
    api: { sendMessage: vi.fn() },
  } as unknown as Context;
}

const testProject = { id: "proj-1", worktree: "/home/user/my-app", name: "My App" };

function switchTestProject(ctx: Context) {
  return switchToProject(ctx, testProject, "test_reason", {
    ...deps,
    ensureEventSubscription: undefined,
    presentation: createProjectSwitchPresentation(deps),
  });
}

describe("app/services/project-switch-service", () => {
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
    await switchTestProject(ctx);

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith(testProject);
    expect(mocked.clearSessionMock).toHaveBeenCalled();
    expect(mocked.summaryAggregatorClearMock).toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("test_reason");
  });

  it("should clear pinned message and refresh context limit", async () => {
    const ctx = createCtx();
    await switchTestProject(ctx);

    expect(mocked.pinnedClearMock).toHaveBeenCalled();
    expect(mocked.pinnedRefreshMock).toHaveBeenCalled();
    expect(mocked.pinnedGetLimitMock).toHaveBeenCalled();
  });

  it("should initialize keyboard manager when ctx.chat exists", async () => {
    const ctx = createCtx(456);
    await switchTestProject(ctx);

    expect(mocked.keyboardInitMock).toHaveBeenCalledWith(ctx.api, 456);
    expect(mocked.keyboardUpdateMock).toHaveBeenCalledWith(0, 128000);
  });

  it("should skip keyboard initialization when ctx.chat is undefined", async () => {
    const ctx = { api: {} } as unknown as Context;
    await switchTestProject(ctx);

    expect(mocked.keyboardInitMock).not.toHaveBeenCalled();
    expect(mocked.keyboardUpdateMock).toHaveBeenCalledWith(0, 128000);
  });

  it("should return keyboard from createMainKeyboard", async () => {
    const ctx = createCtx();
    const result = await switchTestProject(ctx);

    expect(mocked.createMainKeyboardMock).toHaveBeenCalled();
    expect(result).toEqual({ keyboard: [[{ text: "mock" }]] });
  });

  it("should pass model variant to formatVariantForButton", async () => {
    const ctx = createCtx();
    await switchTestProject(ctx);

    expect(mocked.formatVariantMock).toHaveBeenCalledWith("default");
  });

  it("should use 'default' when model variant is undefined", async () => {
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: undefined,
    });
    const ctx = createCtx();
    await switchTestProject(ctx);

    expect(mocked.formatVariantMock).toHaveBeenCalledWith("default");
  });

  it("should not throw if pinnedMessageManager.clear rejects", async () => {
    mocked.pinnedClearMock.mockRejectedValue(new Error("unpin failed"));
    const ctx = createCtx();

    const result = await switchTestProject(ctx);

    expect(mocked.createMainKeyboardMock).toHaveBeenCalled();
    expect(result).toEqual({ keyboard: [[{ text: "mock" }]] });
  });
});
