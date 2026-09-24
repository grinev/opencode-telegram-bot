import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const mocked = vi.hoisted(() => ({
  session: vi.fn(),
  metrics: vi.fn(),
}));
vi.mock("../../../src/app/services/session-service.js", () => ({ getCurrentSession: mocked.session }));
vi.mock("../../../src/app/services/message-history-service.js", () => ({ loadLatestAssistantMetrics: mocked.metrics }));

import { handleContextButtonPress } from "../../../src/bot/menus/context-control-menu.js";

describe("context details menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.session.mockReturnValue({ id: "session", directory: "/project", title: "Task" });
    mocked.metrics.mockResolvedValue(null);
  });

  it("renders the window and latest message metrics with exactly two controls", async () => {
    const deps = createTestAppContainer();
    vi.spyOn(deps.pinnedMessageManager, "getContextInfo").mockReturnValue({ tokensUsed: 65000, tokensLimit: 1000000 });
    mocked.metrics.mockResolvedValue({ input: 123, output: 45, reasoning: 6, cacheRead: 7, cacheWrite: 8, cost: 0.123 });
    const ctx = { reply: vi.fn().mockResolvedValue({ message_id: 42 }) } as unknown as Context;

    await handleContextButtonPress(ctx, deps);

    const [text, options] = vi.mocked(ctx.reply).mock.calls[0]!;
    expect(text).toContain(t("context.details.window", { used: "65K", limit: "1.0M", percent: 7 }));
    expect(text).toContain(t("context.details.input", { count: 123 }));
    expect(text).toContain(t("context.details.cache_write", { count: 8 }));
    expect(text).toContain(t("context.details.cost", { cost: "$0.12" }));
    expect(text).not.toContain("Private answer text");
    const buttons = (options?.reply_markup as InlineKeyboard).inline_keyboard.flat();
    expect(buttons.map((button) => button.text)).toEqual([t("context.button.details_compact"), t("context.button.close")]);
    expect(buttons.map((button) => "callback_data" in button && button.callback_data)).toEqual(["compact:details", "inline:cancel:context"]);
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("details");
  });

  it("shows only the window without a previous assistant message", async () => {
    const deps = createTestAppContainer();
    vi.spyOn(deps.pinnedMessageManager, "getContextInfo").mockReturnValue({ tokensUsed: 0, tokensLimit: 200000 });
    const ctx = { reply: vi.fn().mockResolvedValue({ message_id: 43 }) } as unknown as Context;

    await handleContextButtonPress(ctx, deps);

    const text = vi.mocked(ctx.reply).mock.calls[0]![0];
    expect(text).toContain(t("context.details.window", { used: "0", limit: "200K", percent: 0 }));
    expect(text).not.toContain(t("context.details.token_breakdown"));
  });

  it("keeps the existing no-session hint without fetching history", async () => {
    mocked.session.mockReturnValue(null);
    const ctx = { reply: vi.fn() } as unknown as Context;

    await handleContextButtonPress(ctx, createTestAppContainer());

    expect(ctx.reply).toHaveBeenCalledWith(t("context.no_active_session"));
    expect(mocked.metrics).not.toHaveBeenCalled();
  });
});
