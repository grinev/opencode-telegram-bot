import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({ session: vi.fn(), summarize: vi.fn(), model: vi.fn() }));
vi.mock("../../../src/app/services/session-service.js", () => ({ getCurrentSession: mocked.session }));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({ getStoredModel: mocked.model }));
vi.mock("../../../src/opencode/client.js", () => ({ opencodeClient: { session: { summarize: mocked.summarize } } }));

import { handleCompactConfirm, handleCompactDetails } from "../../../src/bot/callbacks/context-control-callback-handler.js";
import { handleInlineMenuCancel } from "../../../src/bot/callbacks/inline-menu-cancel-callback-handler.js";

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
    mocked.model.mockReturnValue({ providerID: "provider", modelID: "model" });
    mocked.summarize.mockResolvedValue({});
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
    expect(mocked.summarize).toHaveBeenCalledOnce();
    expect(deps.interactionManager.getSnapshot()).toBeNull();
    expect(confirm.deleteMessage).toHaveBeenCalledOnce();
    expect(confirm.reply).toHaveBeenCalledWith(t("context.progress"));
    expect(confirm.api.editMessageText).toHaveBeenCalledWith(100, 8, t("context.success"));
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
