import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import type { GitLogEntry } from "../../../src/app/services/git-service.js";
import { handleLogCallback } from "../../../src/bot/callbacks/log-callback-handler.js";
import { buildLogMenuView } from "../../../src/bot/menus/log-menu.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCommitDiffMock: vi.fn(),
}));

vi.mock("../../../src/app/services/git-service.js", () => ({
  getCommitDiff: mocked.getCommitDiffMock,
}));

function createCommit(overrides: Partial<GitLogEntry> = {}): GitLogEntry {
  return {
    hash: "abc1234",
    relativeDate: "2 hours ago",
    subject: "feat: add thing",
    ...overrides,
  };
}

function startLogMenuInteraction(commits: GitLogEntry[], messageId = 900): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "log",
      messageId,
      dir: "/repo",
      commits,
    },
  });
}

function createLogCallbackContext(data: string, messageId = 900): Context {
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

describe("log menu and callbacks", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.getCommitDiffMock.mockReset();
  });

  it("builds one button per commit with short callback data", () => {
    const commits = Array.from({ length: 10 }, (_, index) =>
      createCommit({
        hash: `hash${index}`,
        subject: `feat: a very long commit subject that needs truncating ${index}`,
      }),
    );

    const { keyboard } = buildLogMenuView(commits);

    expect(keyboard.inline_keyboard).toHaveLength(commits.length);
    for (const row of keyboard.inline_keyboard) {
      for (const button of row) {
        const callbackData = (button as { callback_data?: string }).callback_data ?? "";
        expect(Buffer.byteLength(callbackData, "utf-8")).toBeLessThanOrEqual(64);
      }
    }
  });

  it("sends the selected commit diff and keeps the menu open", async () => {
    startLogMenuInteraction([createCommit()]);
    mocked.getCommitDiffMock.mockResolvedValue("commit abc1234\n+added line");

    const ctx = createLogCallbackContext("log:c:0");
    const handled = await handleLogCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.getCommitDiffMock).toHaveBeenCalledWith("/repo", "abc1234");

    const replyMock = ctx.reply as ReturnType<typeof vi.fn>;
    expect(String(replyMock.mock.calls[0][0])).toContain("+added line");
    expect(interactionManager.getSnapshot()?.kind).toBe("inline");
  });

  it("rejects stale callbacks from an old menu message", async () => {
    startLogMenuInteraction([createCommit()], 900);

    const ctx = createLogCallbackContext("log:c:0", 899);
    const handled = await handleLogCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.getCommitDiffMock).not.toHaveBeenCalled();
  });

  it("answers with an error for an out-of-range commit index", async () => {
    startLogMenuInteraction([createCommit()]);

    const ctx = createLogCallbackContext("log:c:5");
    const handled = await handleLogCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("log.error"),
      show_alert: true,
    });
  });
});
