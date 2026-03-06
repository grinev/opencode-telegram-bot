import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  handleRenameCallback,
  handleRenameText,
  renameCommand,
} from "../../../src/bot/commands/rename.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentSession: {
    id: "session-1",
    title: "Old title",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  sessionUpdateMock: vi.fn(),
  updateCurrentSessionTitleMock: vi.fn(),
  pinnedOnSessionTitleUpdateMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      update: mocked.sessionUpdateMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  updateCurrentSessionTitle: mocked.updateCurrentSessionTitleMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    onSessionTitleUpdate: mocked.pinnedOnSessionTitleUpdateMock,
  },
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createTextContext(text: string): Context {
  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/commands/rename", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.currentSession = {
      id: "session-1",
      title: "Old title",
      directory: "D:\\Projects\\Repo",
    };
    mocked.sessionUpdateMock.mockReset();
    mocked.updateCurrentSessionTitleMock.mockReset();
    mocked.pinnedOnSessionTitleUpdateMock.mockReset();
    mocked.pinnedOnSessionTitleUpdateMock.mockResolvedValue(undefined);
  });

  it("does not start rename flow when there is no active session", async () => {
    mocked.currentSession = null;

    const ctx = createCommandContext(100);
    await renameCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("rename.no_active_session"));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("prompts for the next text message and starts mixed interaction", async () => {
    const ctx = createCommandContext(123);
    await renameCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    expect(text).toBe(t("rename.prompt", { title: "Old title" }));
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("rename:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.flow).toBe("rename");
    expect(state?.metadata.stage).toBe("await_title");
    expect(state?.metadata.messageId).toBe(123);
    expect(state?.metadata.sessionId).toBe("session-1");
    expect(state?.metadata.currentTitle).toBe("Old title");
  });

  it("cancels active rename flow from callback", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        stage: "await_title",
        messageId: 321,
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        currentTitle: "Old title",
      },
    });

    const ctx = createCallbackContext("rename:cancel", 321);
    const handled = await handleRenameCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.cancelled_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("treats stale rename callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        stage: "await_title",
        messageId: 321,
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        currentTitle: "Old title",
      },
    });

    const ctx = createCallbackContext("rename:cancel", 999);
    const handled = await handleRenameCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("custom");
  });

  it("rejects empty title and keeps rename flow active", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        stage: "await_title",
        messageId: 400,
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        currentTitle: "Old title",
      },
    });

    const ctx = createTextContext("   ");
    const handled = await handleRenameText(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty"));
    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
    expect(interactionManager.getSnapshot()?.metadata.flow).toBe("rename");
  });

  it("renames session successfully from next text message", async () => {
    mocked.sessionUpdateMock.mockResolvedValue({
      data: {
        id: "session-1",
        title: "New title",
      },
      error: null,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        stage: "await_title",
        messageId: 456,
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        currentTitle: "Old title",
      },
    });

    const ctx = createTextContext("  New title  ");
    const handled = await handleRenameText(ctx);

    expect(handled).toBe(true);
    expect(mocked.sessionUpdateMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      title: "New title",
    });
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 456);
    expect(mocked.updateCurrentSessionTitleMock).toHaveBeenCalledWith("session-1", "New title");
    expect(mocked.pinnedOnSessionTitleUpdateMock).toHaveBeenCalledWith("New title");
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.success", { title: "New title" }));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("reports rename error when API update fails", async () => {
    mocked.sessionUpdateMock.mockResolvedValue({
      data: null,
      error: new Error("rename failed"),
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "rename",
        stage: "await_title",
        messageId: 789,
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        currentTitle: "Old title",
      },
    });

    const ctx = createTextContext("Broken title");
    const handled = await handleRenameText(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.error"));
    expect(mocked.updateCurrentSessionTitleMock).not.toHaveBeenCalled();
    expect(mocked.pinnedOnSessionTitleUpdateMock).not.toHaveBeenCalled();
    expect(interactionManager.getSnapshot()).toBeNull();
  });
});
