import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { InteractionManager } from "../../../src/app/managers/interaction-manager.js";
import { handleGoalCallback } from "../../../src/bot/callbacks/goal-callback-handler.js";

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: () => ({ id: "s1", directory: "repo" }),
}));

const goal = { id: "g1", objective: "old", status: "active" as const, rounds: 0, maxRounds: 50, updatedAt: 1 };

function setup(read: () => Promise<unknown>) {
  const interactionManager = new InteractionManager();
  interactionManager.start({
    kind: "custom", expectedInput: "callback", metadata: {
      flow: "goal", stage: "confirm", messageId: 42, sessionId: "s1", directory: "repo",
      goalId: goal.id, shownGoal: goal, action: "replace", objective: "new",
    },
  });
  const command = vi.fn().mockResolvedValue({ kind: "ok" });
  const deps = {
    interactionManager,
    attachManager: { isBusy: () => false },
    foregroundSessionState: { isBusy: () => false },
    goalService: { read, command, refresh: vi.fn().mockResolvedValue({ kind: "goal", goal }) },
  } as unknown as Parameters<typeof handleGoalCallback>[1];
  const context = () => ({
    callbackQuery: { data: "goal:confirm", message: { message_id: 42 } },
    chat: { id: 1 }, answerCallbackQuery: vi.fn().mockResolvedValue(undefined), deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn() }, reply: vi.fn(), editMessageText: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Context;
  return { deps, command, context };
}

describe("goal confirmation", () => {
  it("executes only once when two confirmations await the same read", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => { resolve = done; });
    const { deps, command, context } = setup(() => pending);
    const first = handleGoalCallback(context(), deps);
    const second = handleGoalCallback(context(), deps);
    resolve({ kind: "goal", goal });
    await Promise.all([first, second]);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("rejects a goal changed while retaining its ID", async () => {
    const { deps, command, context } = setup(async () => ({ kind: "goal", goal: { ...goal, status: "paused" } }));
    await handleGoalCallback(context(), deps);
    expect(command).not.toHaveBeenCalled();
  });

  it("visibly invalidates an old confirmation after the interaction was reset", async () => {
    const { deps, command, context } = setup(async () => ({ kind: "goal", goal }));
    deps.interactionManager.reset("detach");
    const ctx = context();
    await handleGoalCallback(ctx, deps);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });
});
