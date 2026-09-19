import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { renameCommand } from "../../../src/bot/commands/rename-command.js";
import {
  handleRenameCancel,
  handleRenameTextAnswer,
} from "../../../src/bot/callbacks/rename-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  currentSession: {
    id: "session-1",
    title: "Old title",
    directory: "D:/repo",
  } as { id: string; title: string; directory: string } | null,
  updateSessionMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      update: mocked.updateSessionMock,
    },
  },
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: mocked.setCurrentSessionMock,
}));

function createRenameCommandContext(messageId: number): Context {
  return {
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
  } as unknown as Context;
}

function createRenameTextContext(text: string): Context {
  return {
    chat: { id: 101 },
    message: { text } as Context["message"],
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createRenameCallbackContext(messageId: number): Context {
  return {
    callbackQuery: {
      data: "rename:cancel",
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createDeps() {
  return {
    ...container,
    pinnedMessageManager: {
      isInitialized: vi.fn(() => false),
      onSessionChange: mocked.pinnedOnSessionChangeMock,
    } as never,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/rename", () => {
  beforeEach(() => {
    container.renameManager.clear();
    container.interactionManager.clear("test_setup");

    mocked.currentSession = {
      id: "session-1",
      title: "Old title",
      directory: "D:/repo",
    };
    mocked.updateSessionMock.mockReset();
    mocked.updateSessionMock.mockResolvedValue({
      data: { id: "session-1", title: "New title" },
      error: null,
    });
    mocked.setCurrentSessionMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
  });

  it("starts rename flow and interaction state", async () => {
    const ctx = createRenameCommandContext(555);

    await renameCommand(ctx as never, createDeps());

    expect(container.renameManager.isWaitingForName()).toBe(true);
    expect(container.renameManager.getMessageId()).toBe(555);

    const interactionState = container.interactionManager.getSnapshot();
    expect(interactionState?.kind).toBe("rename");
    expect(interactionState?.expectedInput).toBe("text");
    expect(interactionState?.metadata.sessionId).toBe("session-1");
    expect(interactionState?.metadata.messageId).toBe(555);
  });

  it("renames session on valid text and clears states", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("  New title  ");
    const handled = await handleRenameTextAnswer(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.updateSessionMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:/repo",
      title: "New title",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "New title",
      directory: "D:/repo",
    });
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(101, 555);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.success", { title: "New title" }));
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps rename flow active on empty title", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("   ");
    const handled = await handleRenameTextAnswer(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty_title"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(container.renameManager.isWaitingForName()).toBe(true);
    expect(container.interactionManager.getSnapshot()?.kind).toBe("rename");
  });

  it("keeps rename flow active on a present empty rich title", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("");
    const handled = await handleRenameTextAnswer(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty_title"));
    expect(container.renameManager.isWaitingForName()).toBe(true);
  });

  it("rejects stale rename cancel callback", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameCallbackContext(999);
    const handled = await handleRenameCancel(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(container.renameManager.isWaitingForName()).toBe(true);
    expect(container.interactionManager.getSnapshot()?.kind).toBe("rename");
  });

  it("cancels active rename and clears states", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameCallbackContext(555);
    const handled = await handleRenameCancel(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("rename.cancelled"));
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("does not forward the title as a prompt when session info is missing", async () => {
    // Waiting for a name, but the session behind it is gone.
    container.renameManager.startWaiting("", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.transition({
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("New title");
    const handled = await handleRenameTextAnswer(ctx, createDeps());

    // `true` keeps the text from falling through to the prompt pipeline.
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.inactive"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("closes the rename flow when another interaction takes the slot", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.start({ kind: "inline", expectedInput: "callback" });

    const ctx = createRenameTextContext("New title");
    const handled = await handleRenameTextAnswer(ctx, createDeps());

    expect(handled).toBe(false);
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()?.kind).toBe("inline");
  });

  it("answers a preempted rename cancel button as inactive", async () => {
    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    container.renameManager.setMessageId(555);
    container.interactionManager.start({ kind: "inline", expectedInput: "callback" });

    const ctx = createRenameCallbackContext(555);
    const handled = await handleRenameCancel(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(container.interactionManager.getSnapshot()?.kind).toBe("inline");
  });
});
