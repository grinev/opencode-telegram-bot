import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { InteractionManager } from "../../../src/app/managers/interaction-manager.js";
import { GoalManager } from "../../../src/app/managers/goal-manager.js";
import { KeyboardManager } from "../../../src/bot/keyboards/keyboard-manager.js";
import { handleGoalCallback } from "../../../src/bot/callbacks/goal-callback-handler.js";
import { GoalService } from "../../../src/app/services/goal-service.js";
import { t } from "../../../src/i18n/index.js";

const nativeGoal = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn() }));
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeServerVersion: "v2",
  opencodeClient: {},
  opencodeV2Client: { goal: nativeGoal },
}));

beforeEach(() => {
  nativeGoal.get.mockReset();
  nativeGoal.command.mockReset();
});

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: () => ({ id: "s1", directory: "repo" }),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/agent-selection-service.js")
  >()),
  getStoredAgent: () => "build",
  resolveProjectAgent: async () => "build",
}));
vi.mock("../../../src/app/services/model-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/model-selection-service.js")
  >()),
  getStoredModel: () => ({ providerID: "selected", modelID: "chosen", variant: "high" }),
}));

const goal = {
  id: "g1",
  objective: "old",
  status: "paused" as const,
  rounds: 0,
  maxRounds: 50,
  updatedAt: 1,
};

function setup(read: () => Promise<unknown>, action: "start" | "resume" = "resume") {
  const interactionManager = new InteractionManager();
  const goalManager = new GoalManager();
  goalManager.follow("s1");
  goalManager.apply("s1", action === "resume" ? goal : null, false);
  interactionManager.start({
    kind: "custom",
    expectedInput: "callback",
    metadata: {
      flow: "goal",
      stage: "confirm",
      messageId: 42,
      sessionId: "s1",
      directory: "repo",
      goalId: action === "resume" ? goal.id : null,
      shownGoal: action === "resume" ? goal : null,
      action,
      objective: "old",
      controlToken: goalManager.getControlToken(),
    },
  });
  const command = vi.fn().mockResolvedValue({ kind: "ok" });
  const deps = {
    interactionManager,
    goalManager,
    keyboardManager: new KeyboardManager(goalManager),
    attachManager: { isBusy: () => false },
    foregroundSessionState: { isBusy: () => false },
    goalService: { read, command, refresh: vi.fn().mockResolvedValue({ kind: "goal", goal }) },
  } as unknown as Parameters<typeof handleGoalCallback>[1];
  const context = () =>
    ({
      callbackQuery: { data: "goal:confirm", message: { message_id: 42 } },
      chat: { id: 1 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      api: { sendMessage: vi.fn() },
      reply: vi.fn(),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Context;
  return { deps, command, context };
}

describe("goal confirmation", () => {
  it.each(["start", "resume"] as const)(
    "shows a localized %s action error after SDK selection failure without leaking diagnostics",
    async (action) => {
      const { deps, context } = setup(async () => ({ kind: "none" }), action);
      const service = new GoalService(deps.goalManager);
      nativeGoal.get.mockResolvedValue({ data: action === "resume" ? goal : null });
      const cause = Object.assign(new Error("UnexpectedStatus: 500"), { name: "ClientError" });
      nativeGoal.command.mockResolvedValue({ error: { name: "GoalSelectionError", cause } });
      const ctx = context();
      await handleGoalCallback(ctx, { ...deps, goalService: service });
      expect(nativeGoal.command).toHaveBeenCalledOnce();
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(
        1,
        t("goal.action_error"),
        expect.anything(),
      );
      expect(JSON.stringify(vi.mocked(ctx.api.sendMessage).mock.calls)).not.toContain(
        "UnexpectedStatus",
      );
      expect(JSON.stringify(vi.mocked(ctx.api.sendMessage).mock.calls)).not.toContain(
        t("goal.unsupported"),
      );
      expect(deps.goalManager.snapshot().goal).toEqual(action === "resume" ? goal : null);
    },
  );

  it("executes only once when two confirmations await the same read", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const { deps, command, context } = setup(() => pending);
    const first = handleGoalCallback(context(), deps);
    const second = handleGoalCallback(context(), deps);
    resolve({ kind: "goal", goal });
    await Promise.all([first, second]);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("rejects a goal changed while retaining its ID", async () => {
    const { deps, command, context } = setup(async () => ({
      kind: "goal",
      goal: { ...goal, status: "complete" },
    }));
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
