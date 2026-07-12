import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { handleGitCallback } from "../../../src/bot/callbacks/git-callback-handler.js";
import { buildGitMenuView } from "../../../src/bot/menus/git-menu.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  runDiffFlowMock: vi.fn(),
  runCommitFlowMock: vi.fn(),
}));

vi.mock("../../../src/bot/flows/diff-flow.js", () => ({
  runDiffFlow: mocked.runDiffFlowMock,
}));

vi.mock("../../../src/bot/flows/commit-flow.js", () => ({
  runCommitFlow: mocked.runCommitFlowMock,
}));

function startGitMenuInteraction(messageId = 900): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "git",
      messageId,
    },
  });
}

function createGitCallbackContext(data: string, messageId = 900): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 1000 }),
  } as unknown as Context;
}

describe("git menu and callbacks", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.runDiffFlowMock.mockReset().mockResolvedValue(undefined);
    mocked.runCommitFlowMock.mockReset().mockResolvedValue(undefined);
  });

  it("builds a menu with diff and commit buttons", () => {
    const { text, keyboard } = buildGitMenuView();

    expect(text).toBe(t("git.menu.title"));

    const callbackData = keyboard.inline_keyboard
      .flat()
      .map((button) => (button as { callback_data?: string }).callback_data);
    expect(callbackData).toEqual(["git:diff", "git:commit"]);
  });

  it("runs the diff flow and closes the menu on git:diff", async () => {
    startGitMenuInteraction();

    const ctx = createGitCallbackContext("git:diff");
    const handled = await handleGitCallback(ctx);

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(mocked.runDiffFlowMock).toHaveBeenCalledWith(ctx);
    expect(mocked.runCommitFlowMock).not.toHaveBeenCalled();
  });

  it("runs the commit flow and closes the menu on git:commit", async () => {
    startGitMenuInteraction();

    const ctx = createGitCallbackContext("git:commit");
    const handled = await handleGitCallback(ctx);

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(mocked.runCommitFlowMock).toHaveBeenCalledWith(ctx);
    expect(mocked.runDiffFlowMock).not.toHaveBeenCalled();
  });

  it("ignores non-git callback data", async () => {
    startGitMenuInteraction();

    const ctx = createGitCallbackContext("diff:f:0");
    const handled = await handleGitCallback(ctx);

    expect(handled).toBe(false);
    expect(mocked.runDiffFlowMock).not.toHaveBeenCalled();
    expect(interactionManager.getSnapshot()?.kind).toBe("inline");
  });

  it("rejects stale callbacks from an old menu message", async () => {
    startGitMenuInteraction(900);

    const ctx = createGitCallbackContext("git:diff", 899);
    const handled = await handleGitCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.runDiffFlowMock).not.toHaveBeenCalled();
  });

  it("reports an error when the selected flow throws", async () => {
    startGitMenuInteraction();
    mocked.runDiffFlowMock.mockRejectedValue(new Error("boom"));

    const ctx = createGitCallbackContext("git:diff");
    const handled = await handleGitCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("callback.processing_error"));
  });
});
