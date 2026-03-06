import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { handleContextButtonPress } from "../../../src/bot/handlers/context.js";

const mocked = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  clearActiveInlineMenu: vi.fn(),
  ensureActiveInlineMenu: vi.fn(),
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

function createMessageContext(options: { threadId?: number; isForum?: boolean }): Context {
  const { threadId, isForum = true } = options;

  return {
    chat: {
      id: -1001,
      type: "supergroup",
      is_forum: isForum,
    } as unknown as Context["chat"],
    message: {
      text: "📊",
      ...(typeof threadId === "number" ? { message_thread_id: threadId } : {}),
    } as unknown as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/handlers/context", () => {
  beforeEach(() => {
    mocked.getCurrentSessionMock.mockReset();
    mocked.replyWithInlineMenuMock.mockReset();
  });

  it("returns General-scope guidance instead of opening compact menu", async () => {
    const ctx = createMessageContext({ threadId: 1 });
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "s1",
      title: "Session",
      directory: "/repo",
    });

    await handleContextButtonPress(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("context.general_not_available"), {});
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("keeps existing no-session behavior in non-General topic", async () => {
    const ctx = createMessageContext({ threadId: 77 });
    mocked.getCurrentSessionMock.mockReturnValue(null);

    await handleContextButtonPress(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("context.no_active_session"), {
      message_thread_id: 77,
    });
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });
});
