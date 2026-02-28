import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { handleProjectSelect } from "../../../src/bot/commands/projects.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
}));

vi.mock("../../../src/project/manager.js", () => ({
  getProjects: mocked.getProjectsMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/projects handleProjectSelect", () => {
  beforeEach(() => {
    mocked.getProjectsMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
  });

  it("uses callback feedback and does not send chat reply on projects:page:* load error", async () => {
    const ctx = createCallbackContext("projects:page:1");
    const pageLoadError = new Error("failed to load page");
    mocked.getProjectsMock.mockRejectedValue(pageLoadError);

    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("projects.page_load_error"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).not.toHaveBeenCalled();
  });

  it("keeps project:* selection error behavior with state cleanup and chat error reply", async () => {
    const ctx = createCallbackContext("project:abc");
    mocked.getProjectsMock.mockResolvedValue([
      {
        id: "different-id",
        name: "Other project",
        worktree: "/tmp/other",
      },
    ]);

    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("project_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.select_error"));
  });
});
