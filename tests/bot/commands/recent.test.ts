import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { recentCommand } from "../../../src/bot/commands/recent-command.js";
import { handleRecentSelect } from "../../../src/bot/callbacks/recent-callback-handler.js";
import { startInteractionForTest } from "../../helpers/interaction.js";

const mocked = vi.hoisted(() => ({
  rows: vi.fn(), get: vi.fn(), switch: vi.fn(), select: vi.fn(),
  currentProject: null as { worktree: string } | null,
}));
vi.mock("../../../src/app/services/recent-sessions-service.js", () => ({ loadRecentSessions: mocked.rows }));
vi.mock("../../../src/opencode/client.js", () => ({ opencodeClient: { session: { get: mocked.get } } }));
vi.mock("../../../src/app/services/project-switch-service.js", () => ({ switchToProject: mocked.switch }));
vi.mock("../../../src/app/stores/settings-store.js", () => ({ getCurrentProject: () => mocked.currentProject }));
vi.mock("../../../src/bot/callbacks/session-callback-handler.js", () => ({ selectSessionById: mocked.select }));

function context(data?: string): Context {
  return {
    chat: { id: 1 },
    callbackQuery: data ? { data, message: { message_id: 20 } } : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: 20 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("/recent and picker", () => {
  beforeEach(() => {
    mocked.rows.mockReset(); mocked.get.mockReset();
    mocked.switch.mockReset(); mocked.select.mockReset();
    mocked.currentProject = null;
  });

  it("opens the picker without a project and handles the empty list", async () => {
    const deps = createTestAppContainer();
    mocked.rows.mockResolvedValueOnce([{ session: { id: "first", title: "First", directory: "/other" }, status: "idle" }])
      .mockResolvedValueOnce([]);
    const ctx = context();
    await recentCommand(ctx as never, deps);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Recent sessions"), expect.anything());
    expect(deps.interactionManager.getSnapshot()?.metadata).toMatchObject({ sessionIds: ["first"], directories: ["/other"] });
    const empty = context();
    await recentCommand(empty as never, deps);
    expect(empty.reply).toHaveBeenCalledWith(expect.stringContaining("No sessions"));
  });

  it("switches to another worktree and uses the existing selection preview", async () => {
    const deps = createTestAppContainer();
    startInteractionForTest(deps.interactionManager, {
      kind: "inline", expectedInput: "callback",
      metadata: { menuKind: "recent", messageId: 20, sessionIds: ["s1"], directories: ["/linked"] },
    });
    mocked.get.mockResolvedValue({ data: { id: "s1", projectID: "project", directory: "/linked", time: { updated: 10 } }, error: null });
    const ctx = context("recent:0");
    expect(await handleRecentSelect(ctx, { ...deps, bot: {} } as never)).toBe(true);
    expect(mocked.switch).toHaveBeenCalledWith(ctx, { id: "project", worktree: "/linked", name: "/linked" }, "recent_project_switched", expect.anything());
    expect(mocked.select).toHaveBeenCalledWith(ctx, expect.anything(), "s1", expect.objectContaining({ postSelectAction: "preview" }));
  });

  it("rejects stale rows and leaves the current project untouched", async () => {
    const deps = createTestAppContainer();
    startInteractionForTest(deps.interactionManager, {
      kind: "inline", expectedInput: "callback",
      metadata: { menuKind: "recent", messageId: 20, sessionIds: ["s1"], directories: ["/gone"] },
    });
    mocked.get.mockResolvedValue({ data: null, error: new Error("gone") });
    const ctx = context("recent:0");
    await handleRecentSelect(ctx, { ...deps, bot: {} } as never);
    expect(mocked.switch).not.toHaveBeenCalled();
    expect(mocked.select).not.toHaveBeenCalled();
  });
});
