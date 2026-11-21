import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  session: vi.fn(), title: vi.fn(), summarize: vi.fn(), model: vi.fn(), messages: vi.fn(),
}));
vi.mock("../../../src/app/services/session-service.js", () => ({ getCurrentSession: mocked.session, fetchSessionTitle: mocked.title }));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({ getStoredModel: mocked.model }));
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeServerVersion: "v1",
  opencodeClient: {
    session: { summarize: mocked.summarize, messages: mocked.messages, status: vi.fn().mockResolvedValue({ data: {} }) },
  },
}));

import { handleCompactConfirm, handleCompactDetails } from "../../../src/bot/callbacks/context-control-callback-handler.js";
import { handleInlineMenuCancel } from "../../../src/bot/callbacks/inline-menu-cancel-callback-handler.js";

function publishCompaction() {
  mocked.messages.mockResolvedValue({ data: [
    { info: { id: "manual" }, parts: [{ type: "compaction", auto: false }] },
    { info: { role: "assistant", parentID: "manual", summary: true, finish: "stop" }, parts: [] },
  ] });
}

function callback(data: string, messageId = 7): Context {
  return {
    callbackQuery: { data, message: { message_id: messageId } },
    chat: { id: 100 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 8 }),
    api: { sendChatAction: vi.fn().mockResolvedValue(undefined), editMessageText: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Context;
}

describe("context compaction flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.session.mockReturnValue({ id: "session", directory: "/project", title: "Task" });
    mocked.title.mockResolvedValue("Task");
    mocked.model.mockReturnValue({ providerID: "provider", modelID: "model" });
    mocked.messages.mockResolvedValue({ data: [] });
    mocked.summarize.mockImplementation(async () => {
      publishCompaction();
      return { data: true };
    });
  });

  it("edits details into confirmation and compacts only after confirming", async () => {
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "details" } });
    const early = callback("compact:confirm");
    await handleCompactConfirm(early, deps);
    expect(mocked.summarize).not.toHaveBeenCalled();

    const details = callback("compact:details");
    await handleCompactDetails(details, deps);
    expect(details.answerCallbackQuery).toHaveBeenCalledOnce();
    const [text, options] = vi.mocked(details.editMessageText).mock.calls[0]!;
    expect(text).toBe(t("context.confirm_text", { title: "Task" }));
    expect(options?.reply_markup?.inline_keyboard.flat().map((button) => button.text)).toEqual([
      t("context.button.confirm"), t("inline.button.cancel"),
    ]);
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("confirm");
    expect(mocked.summarize).not.toHaveBeenCalled();

    const confirm = callback("compact:confirm");
    await handleCompactConfirm(confirm, deps);
    await vi.waitFor(() => expect(mocked.summarize).toHaveBeenCalledOnce());
    expect(deps.interactionManager.getSnapshot()).toBeNull();
    expect(confirm.deleteMessage).toHaveBeenCalledOnce();
    expect(confirm.reply).toHaveBeenCalledWith(t("context.progress"));
    await vi.waitFor(() =>
      expect(confirm.api.editMessageText).toHaveBeenCalledWith(100, 8, t("context.success")),
    );
  });

  it("does not wait for the compaction to finish", async () => {
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "confirm" } });
    let finish!: (value: unknown) => void;
    mocked.summarize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const ctx = callback("compact:confirm");

    await handleCompactConfirm(ctx, deps);

    await vi.waitFor(() => expect(mocked.summarize).toHaveBeenCalledOnce());
    expect(deps.manualCompaction.isActive("session")).toBe(true);
    expect(ctx.api.editMessageText).not.toHaveBeenCalledWith(100, 8, t("context.success"));
    publishCompaction();
    finish({ data: true });
    await vi.waitFor(() =>
      expect(ctx.api.editMessageText).toHaveBeenCalledWith(100, 8, t("context.success")),
    );
  });

  it("rejects a second confirmation while a compaction is still running", async () => {
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "confirm" } });
    let finish!: (value: unknown) => void;
    mocked.summarize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = callback("compact:confirm");
    await handleCompactConfirm(first, deps);

    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 9, stage: "confirm" } });
    const second = callback("compact:confirm", 9);
    await handleCompactConfirm(second, deps);

    expect(mocked.summarize).toHaveBeenCalledOnce();
    expect(second.answerCallbackQuery).toHaveBeenCalledWith({ text: t("context.callback_compacting") });
    expect(second.reply).not.toHaveBeenCalled();
    expect(second.deleteMessage).toHaveBeenCalledOnce();
    expect(deps.interactionManager.getSnapshot()).toBeNull();

    publishCompaction();
    finish({ data: true });
    await vi.waitFor(() =>
      expect(first.api.editMessageText).toHaveBeenCalledWith(100, 8, t("context.success")),
    );
  });

  it("reports a failed compaction through the progress message", async () => {
    for (const result of [
      () => Promise.resolve({ error: new Error("boom") }),
      () => Promise.reject(new Error("drop")),
    ]) {
      const deps = createTestAppContainer();
      deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "confirm" } });
      mocked.summarize.mockImplementationOnce(result);
      const ctx = callback("compact:confirm");

      await handleCompactConfirm(ctx, deps);

      await vi.waitFor(() =>
        expect(ctx.api.editMessageText).toHaveBeenCalledWith(100, 8, t("context.error")),
      );
    }

    // The guard is released after a failed compaction, so a later confirm compacts again.
    const callsBefore = mocked.summarize.mock.calls.length;
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "confirm" } });
    const retry = callback("compact:confirm");
    await handleCompactConfirm(retry, deps);
    await vi.waitFor(() => expect(mocked.summarize).toHaveBeenCalledTimes(callsBefore + 1));
  });

  it("closes details or cancels confirmation without compacting", async () => {
    for (const stage of ["details", "confirm"]) {
      const deps = createTestAppContainer();
      deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage } });
      const ctx = callback("inline:cancel:context");
      expect(await handleInlineMenuCancel(ctx, deps)).toBe(true);
      expect(ctx.deleteMessage).toHaveBeenCalledOnce();
      expect(deps.interactionManager.getSnapshot()).toBeNull();
    }
    expect(mocked.summarize).not.toHaveBeenCalled();
  });

  it("rejects callbacks from a different message and repeated details action", async () => {
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "details" } });
    const stale = callback("compact:details", 8);
    await handleCompactDetails(stale, deps);
    expect(stale.editMessageText).not.toHaveBeenCalled();

    await handleCompactDetails(callback("compact:details"), deps);
    const repeated = callback("compact:details");
    await handleCompactDetails(repeated, deps);
    expect(repeated.editMessageText).not.toHaveBeenCalled();
    expect(mocked.summarize).not.toHaveBeenCalled();
  });

  it("names the session with the title OpenCode has for it, or as a new session while untitled", async () => {
    for (const [fetched, shown] of [["Generated title", "Generated title"], ["", t("pinned.default_session_title")]]) {
      mocked.title.mockResolvedValue(fetched);
      const deps = createTestAppContainer();
      deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "details" } });
      const ctx = callback("compact:details");
      await handleCompactDetails(ctx, deps);
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("context.confirm_text", { title: shown }), expect.anything());
    }
    expect(mocked.title).toHaveBeenCalledWith({ id: "session", directory: "/project", title: "Task" });
  });

  it("answers the callback before waiting for Telegram to edit the confirmation", async () => {
    const deps = createTestAppContainer();
    deps.interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: { menuKind: "context", messageId: 7, stage: "details" } });
    const ctx = callback("compact:details");
    let finishEdit!: (value: true) => void;
    vi.mocked(ctx.editMessageText).mockReturnValue(new Promise<true>((resolve) => { finishEdit = resolve; }));

    const pending = handleCompactDetails(ctx, deps);
    await vi.waitFor(() => expect(ctx.editMessageText).toHaveBeenCalledOnce());
    expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("details");
    finishEdit(true);
    await pending;
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("confirm");
  });
});
