import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardCardManager } from "../../../src/app/managers/dashboard-card-manager.js";
import type { InteractionState } from "../../../src/app/types/interaction.js";
import { handleDashboardClose, handleDashboardOpen, retireDashboardCard } from "../../../src/bot/dashboard/dashboard-card.js";
import { renderDashboard } from "../../../src/bot/render/dashboard.js";
import { TELEGRAM_TEXT_MESSAGE_LIMIT } from "../../../src/bot/render/limits.js";
import { t } from "../../../src/i18n/index.js";
import { deferred } from "../../helpers/deferred.js";

const selected = vi.hoisted(() => ({
  project: { id: "project", name: "Project", worktree: "/repo" },
  session: { id: "session", title: "Full session title", directory: "/repo" },
  getCurrentProject: vi.fn(),
  getCurrentSession: vi.fn(),
  git: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: selected.getCurrentProject,
  getCurrentSession: selected.getCurrentSession,
}));
vi.mock("../../../src/app/services/worktree-service.js", () => ({ getGitWorktreeContext: selected.git }));

function fixture(label = "📋 [Project] Full session title") {
  const api = { sendMessage: vi.fn(), deleteMessage: vi.fn().mockResolvedValue(true) };
  api.sendMessage.mockResolvedValueOnce({ message_id: 11 }).mockResolvedValue({ message_id: 12 });
  const deps = {
    dashboardCardManager: new DashboardCardManager(),
    goalManager: { snapshot: () => ({ sessionId: null, goal: null }) },
    interactionManager: { getSnapshot: vi.fn<() => InteractionState | null>(() => null) },
    keyboardManager: { initialize: vi.fn(), sendKeyboardUpdate: vi.fn().mockResolvedValue(undefined) },
    sessionMetricsManager: {
      snapshot: vi.fn().mockResolvedValue({
        tokensUsed: 1_000, tokensLimit: 200_000, cost: 0.42,
        changedFiles: [{ file: "/repo/a.ts", additions: 2, deletions: 1 }],
      }),
    },
  };
  const reply = vi.fn();
  const ctx = { chat: { id: 1 }, message: { text: label }, api, reply } as unknown as Context;
  const close = (id: number, chatId = 1) => {
    const answerCallbackQuery = vi.fn();
    const callback = {
      api, answerCallbackQuery,
      callbackQuery: { data: "dashboard:close", message: { chat: { id: chatId }, message_id: id } },
    } as unknown as Context;
    return { callback, answerCallbackQuery };
  };
  const open = () => handleDashboardOpen(ctx, deps as unknown as Parameters<typeof handleDashboardOpen>[1]);
  return { api, close, ctx, deps, open, reply };
}

describe("on-demand dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    selected.getCurrentProject.mockReturnValue(selected.project);
    selected.getCurrentSession.mockReturnValue(selected.session);
    selected.git.mockResolvedValue({
      mainProjectPath: "/repo", activeWorktreePath: "/repo", branch: "main", isLinkedWorktree: false,
    });
  });

  it("sends a stale keyboard update before the current plain snapshot and replaces it with a fresh card", async () => {
    const { api, deps, open } = fixture("📋 [Old project] Old session");
    await open();
    await open();

    expect(deps.keyboardManager.sendKeyboardUpdate).toHaveBeenCalledBefore(api.sendMessage);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenCalledWith(1, expect.stringMatching(/Full session title[\s\S]*\$0\.42[\s\S]*a\.ts \(\+2 -1\)/), {
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "❌ Close", callback_data: "dashboard:close" }]] },
    });
    expect(api.deleteMessage).toHaveBeenCalledExactlyOnceWith(1, 11);
    expect(api.sendMessage.mock.calls[0]?.[1]).not.toMatch(/Model:|Agent:|Effort:/);
  });

  it("leaves failed deletes inactive and closes only the matching current card", async () => {
    const { api, close, deps, open } = fixture();
    api.deleteMessage.mockRejectedValueOnce(new Error("message too old"));
    await open();
    await open();

    expect(deps.keyboardManager.sendKeyboardUpdate).not.toHaveBeenCalled();
    const expired = close(11);
    const wrongChat = close(12, 2);
    const active = close(12);
    await handleDashboardClose(expired.callback, deps.dashboardCardManager);
    await handleDashboardClose(wrongChat.callback, deps.dashboardCardManager);
    await handleDashboardClose(active.callback, deps.dashboardCardManager);

    expect(expired.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ text: expect.any(String) }));
    expect(wrongChat.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ text: expect.any(String) }));
    expect(active.answerCallbackQuery).toHaveBeenCalledWith();
    expect(api.deleteMessage.mock.calls).toEqual([[1, 11], [1, 12]]);
  });

  it("retires an in-flight send after the selection changes and never activates the returned id", async () => {
    const { api, ctx, deps, open, close } = fixture();
    const pending = deferred<{ message_id: number }>();
    api.sendMessage.mockReset().mockReturnValue(pending.promise);
    const sending = open();
    await vi.waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    retireDashboardCard(ctx.api, deps.dashboardCardManager);
    pending.resolve({ message_id: 42 });
    await sending;
    const old = close(42);
    await handleDashboardClose(old.callback, deps.dashboardCardManager);
    expect(api.deleteMessage).toHaveBeenCalledExactlyOnceWith(1, 42);
    expect(old.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ text: expect.any(String) }));
  });

  it("retires an in-flight send if a permission prompt opens", async () => {
    const { api, deps, open, close, reply } = fixture();
    const pending = deferred<{ message_id: number }>();
    api.sendMessage.mockReset().mockReturnValue(pending.promise);
    const sending = open();
    await vi.waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    deps.interactionManager.getSnapshot.mockReturnValue({ kind: "permission", expectedInput: "callback" } as InteractionState);
    pending.resolve({ message_id: 42 });
    await sending;
    const old = close(42);
    await handleDashboardClose(old.callback, deps.dashboardCardManager);

    expect(api.deleteMessage).toHaveBeenCalledExactlyOnceWith(1, 42);
    expect(reply).toHaveBeenCalledExactlyOnceWith(t("permission.blocked.expected_reply"));
    expect(old.answerCallbackQuery).toHaveBeenCalledExactlyOnceWith({ text: t("inline.inactive_callback") });
  });

  it("does not load session metrics when there is only a project", async () => {
    selected.getCurrentSession.mockReturnValue(undefined);
    const { api, deps, open } = fixture("📋 [Project] No session");
    await open();
    expect(deps.sessionMetricsManager.snapshot).not.toHaveBeenCalled();
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain("Session not selected. Use /sessions or /new.");
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain("Project (/repo): main");
  });

  it("fits extreme title and project headings into one card without dropping cost and file totals", () => {
    const text = renderDashboard({
      session: { ...selected.session, title: "🚀".repeat(2000) },
      project: { ...selected.project, name: "P".repeat(600) },
      git: null,
      goal: "Current goal",
      metrics: {
        tokensUsed: 1_000, tokensLimit: 200_000, cost: 0.42,
        changedFiles: [{ file: "a.ts", additions: 2, deletions: 1 }],
      },
    });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MESSAGE_LIMIT);
    expect(text).toContain("…");
    expect(text).toContain("Current goal");
    expect(text).toContain("$0.42");
    expect(text).toContain("Files (1)");
  });
});
