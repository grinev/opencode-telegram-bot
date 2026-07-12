import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import {
  handleCommitCallback,
  handleCommitEditTextInput,
} from "../../../src/bot/callbacks/commit-callback-handler.js";
import { showCommitConfirmation } from "../../../src/bot/menus/commit-menu.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  commitAllMock: vi.fn(),
  generateCommitMessageMock: vi.fn(),
  pinnedRefreshMock: vi.fn(),
}));

vi.mock("../../../src/app/services/git-service.js", () => ({
  commitAll: mocked.commitAllMock,
}));

vi.mock("../../../src/app/services/commit-message-service.js", () => ({
  generateCommitMessage: mocked.generateCommitMessageMock,
}));

vi.mock("../../../src/bot/pinned/pinned-message-manager.js", () => ({
  pinnedMessageManager: {
    refresh: mocked.pinnedRefreshMock,
  },
}));

function createCommitContext(data: string | null, messageId = 950): Context {
  return {
    chat: { id: 777 },
    callbackQuery: data
      ? ({ data, message: { message_id: messageId } } as Context["callbackQuery"])
      : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 950, chat: { id: 777 } }),
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as unknown as Context;
}

async function openCommitConfirmation(message = "feat: initial message"): Promise<void> {
  const ctx = createCommitContext(null);
  await showCommitConfirmation(ctx, "/repo", message, true);
}

describe("commit flow", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.commitAllMock.mockReset();
    mocked.generateCommitMessageMock.mockReset();
    mocked.pinnedRefreshMock.mockReset();
    mocked.pinnedRefreshMock.mockResolvedValue(undefined);
  });

  it("starts the confirm interaction with commit metadata", async () => {
    await openCommitConfirmation("feat: hello");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.flow).toBe("commit");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.dir).toBe("/repo");
    expect(state?.metadata.message).toBe("feat: hello");
    expect(state?.metadata.messageId).toBe(950);
  });

  it("commits on confirm, reports success and clears the interaction", async () => {
    await openCommitConfirmation("feat: hello");
    mocked.commitAllMock.mockResolvedValue({ hash: "abc1234" });

    const ctx = createCommitContext("commit:go");
    const handled = await handleCommitCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.commitAllMock).toHaveBeenCalledWith("/repo", "feat: hello");
    expect(ctx.reply).toHaveBeenCalledWith(
      t("commit.success", { hash: "abc1234", message: "feat: hello" }),
    );
    expect(mocked.pinnedRefreshMock).toHaveBeenCalled();
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("reports an error and clears the interaction when git commit fails", async () => {
    await openCommitConfirmation();
    mocked.commitAllMock.mockRejectedValue(new Error("hook failed"));

    const ctx = createCommitContext("commit:go");
    await handleCommitCallback(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("commit.error"));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("cancels the flow", async () => {
    await openCommitConfirmation();

    const ctx = createCommitContext("commit:cancel");
    await handleCommitCallback(ctx);

    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(mocked.commitAllMock).not.toHaveBeenCalled();
  });

  it("regenerates the message and re-shows the confirmation", async () => {
    await openCommitConfirmation("feat: old");
    mocked.generateCommitMessageMock.mockResolvedValue({
      message: "feat: regenerated",
      generated: true,
    });

    const ctx = createCommitContext("commit:regen");
    await handleCommitCallback(ctx);

    expect(mocked.generateCommitMessageMock).toHaveBeenCalledWith("/repo");

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.message).toBe("feat: regenerated");
  });

  it("switches to edit stage and accepts the edited message as text input", async () => {
    await openCommitConfirmation("feat: old");

    const editCtx = createCommitContext("commit:edit");
    await handleCommitCallback(editCtx);

    expect(interactionManager.getSnapshot()?.metadata.stage).toBe("edit");
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("text");

    const textCtx = {
      chat: { id: 777 },
      message: { text: "fix: my own message" },
      reply: vi.fn().mockResolvedValue({ message_id: 951, chat: { id: 777 } }),
    } as unknown as Context;

    const handled = await handleCommitEditTextInput(textCtx);

    expect(handled).toBe(true);
    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.message).toBe("fix: my own message");
    expect(state?.metadata.messageId).toBe(951);
  });

  it("rejects stale callbacks from an outdated confirmation message", async () => {
    await openCommitConfirmation();

    const ctx = createCommitContext("commit:go", 949);
    const handled = await handleCommitCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.commitAllMock).not.toHaveBeenCalled();
  });

  it("ignores text input when not in edit stage", async () => {
    await openCommitConfirmation();

    const textCtx = {
      chat: { id: 777 },
      message: { text: "random prompt" },
      reply: vi.fn(),
    } as unknown as Context;

    const handled = await handleCommitEditTextInput(textCtx);
    expect(handled).toBe(false);
  });
});
