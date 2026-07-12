import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { buildDiffMenuView } from "../../../src/bot/menus/diff-menu.js";
import { handleDiffCallback } from "../../../src/bot/callbacks/diff-callback-handler.js";
import type { GitChangedFile } from "../../../src/app/services/git-service.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getFileDiffMock: vi.fn(),
  getFullPatchMock: vi.fn(),
}));

vi.mock("../../../src/app/services/git-service.js", () => ({
  getFileDiff: mocked.getFileDiffMock,
  getFullPatch: mocked.getFullPatchMock,
}));

function createChangedFile(overrides: Partial<GitChangedFile> = {}): GitChangedFile {
  return {
    path: "src/app.ts",
    status: "M",
    additions: 3,
    deletions: 1,
    binary: false,
    untracked: false,
    ...overrides,
  };
}

function startDiffMenuInteraction(files: GitChangedFile[], messageId = 900): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "diff",
      messageId,
      dir: "/repo",
      files,
    },
  });
}

function createDiffCallbackContext(data: string, messageId = 900): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 1000 }),
    replyWithDocument: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Context;
}

describe("diff menu and callbacks", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.getFileDiffMock.mockReset();
    mocked.getFullPatchMock.mockReset();
  });

  it("builds file buttons with short callback data", () => {
    const files = Array.from({ length: 30 }, (_, index) =>
      createChangedFile({ path: `src/deeply/nested/path/to/some/file-${index}.ts` }),
    );

    const { keyboard } = buildDiffMenuView(files);

    for (const row of keyboard.inline_keyboard) {
      for (const button of row) {
        const callbackData = (button as { callback_data?: string }).callback_data ?? "";
        expect(Buffer.byteLength(callbackData, "utf-8")).toBeLessThanOrEqual(64);
      }
    }

    // One row per file plus the patch button row.
    expect(keyboard.inline_keyboard.length).toBe(files.length + 1);
  });

  it("sends the file diff as rendered message parts", async () => {
    startDiffMenuInteraction([createChangedFile()]);
    mocked.getFileDiffMock.mockResolvedValue("--- a/src/app.ts\n+++ b/src/app.ts\n+added line");

    const ctx = createDiffCallbackContext("diff:f:0");
    const handled = await handleDiffCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.getFileDiffMock).toHaveBeenCalledWith("/repo", "src/app.ts", {
      untracked: false,
    });

    const replyMock = ctx.reply as ReturnType<typeof vi.fn>;
    expect(replyMock).toHaveBeenCalled();
    expect(String(replyMock.mock.calls[0][0])).toContain("+added line");

    // Menu stays open for further file inspection.
    expect(interactionManager.getSnapshot()?.kind).toBe("inline");
  });

  it("diffs untracked files against /dev/null", async () => {
    startDiffMenuInteraction([createChangedFile({ path: "new.txt", untracked: true })]);
    mocked.getFileDiffMock.mockResolvedValue("+new content");

    const ctx = createDiffCallbackContext("diff:f:0");
    await handleDiffCallback(ctx);

    expect(mocked.getFileDiffMock).toHaveBeenCalledWith("/repo", "new.txt", { untracked: true });
  });

  it("sends the full patch as a document and closes the menu", async () => {
    startDiffMenuInteraction([createChangedFile()]);
    mocked.getFullPatchMock.mockResolvedValue("diff --git full patch");

    const ctx = createDiffCallbackContext("diff:patch");
    const handled = await handleDiffCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.replyWithDocument).toHaveBeenCalled();
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("rejects stale callbacks from an old menu message", async () => {
    startDiffMenuInteraction([createChangedFile()], 900);

    const ctx = createDiffCallbackContext("diff:f:0", 899);
    const handled = await handleDiffCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.getFileDiffMock).not.toHaveBeenCalled();
  });

  it("answers with an error for an out-of-range file index", async () => {
    startDiffMenuInteraction([createChangedFile()]);

    const ctx = createDiffCallbackContext("diff:f:5");
    const handled = await handleDiffCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("diff.file_error"),
      show_alert: true,
    });
  });
});
