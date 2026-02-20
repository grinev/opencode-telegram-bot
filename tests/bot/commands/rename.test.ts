import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  renameCommand,
  handleRenameCancel,
  handleRenameTextAnswer,
} from "../../../src/bot/commands/rename.js";
import { renameManager } from "../../../src/rename/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

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

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: mocked.setCurrentSessionMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(() => false),
    onSessionChange: mocked.pinnedOnSessionChangeMock,
  },
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

describe("bot/commands/rename", () => {
  beforeEach(() => {
    renameManager.clear();
    interactionManager.clear("test_setup");

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

    await renameCommand(ctx as never);

    expect(renameManager.isWaitingForName()).toBe(true);
    expect(renameManager.getMessageId()).toBe(555);

    const interactionState = interactionManager.getSnapshot();
    expect(interactionState?.kind).toBe("rename");
    expect(interactionState?.expectedInput).toBe("text");
    expect(interactionState?.metadata.sessionId).toBe("session-1");
    expect(interactionState?.metadata.messageId).toBe(555);
  });

  it("renames session on valid text and clears states", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    renameManager.setMessageId(555);
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("  New title  ");
    const handled = await handleRenameTextAnswer(ctx);

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
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps rename flow active on empty title", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    renameManager.setMessageId(555);
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameTextContext("   ");
    const handled = await handleRenameTextAnswer(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty_title"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(renameManager.isWaitingForName()).toBe(true);
    expect(interactionManager.getSnapshot()?.kind).toBe("rename");
  });

  it("rejects stale rename cancel callback", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    renameManager.setMessageId(555);
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameCallbackContext(999);
    const handled = await handleRenameCancel(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(renameManager.isWaitingForName()).toBe(true);
    expect(interactionManager.getSnapshot()?.kind).toBe("rename");
  });

  it("cancels active rename and clears states", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    renameManager.setMessageId(555);
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1", messageId: 555 },
    });

    const ctx = createRenameCallbackContext(555);
    const handled = await handleRenameCancel(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("rename.cancelled"));
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears stale rename manager state when interaction is missing", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    renameManager.setMessageId(555);

    const ctx = createRenameTextContext("New title");
    const handled = await handleRenameTextAnswer(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.inactive"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(renameManager.isWaitingForName()).toBe(false);
  });
});
