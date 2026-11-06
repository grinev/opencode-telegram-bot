import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import type { GoalState } from "../../../src/app/types/goal.js";
import {
  goalCommand,
  handleGoalButton,
  handleGoalTextInput,
  goalDeleteData,
} from "../../../src/bot/commands/goal-command.js";
import { handleGoalCallback } from "../../../src/bot/callbacks/goal-callback-handler.js";
import { getGoalButtonLabels } from "../../../src/bot/keyboards/goal-button.js";
import { resolveInteractionGuardDecision } from "../../../src/bot/middleware/interaction-guard-decision.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  session: { id: "s1", directory: "repo" } as { id: string; directory: string } | null,
  resolveAgent: vi.fn(),
  model: { providerID: "selected", modelID: "chosen", variant: "high" },
}));
vi.mock("../../../src/app/services/agent-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/agent-selection-service.js")
  >()),
  getStoredAgent: () => "build",
  resolveProjectAgent: mocked.resolveAgent,
}));
vi.mock("../../../src/app/services/model-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/model-selection-service.js")
  >()),
  getStoredModel: () => mocked.model,
}));
vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: () => mocked.session,
}));
vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/stores/settings-store.js")>()),
  getCurrentProject: () => ({ id: "p1", worktree: "repo" }),
}));

const initialGoal: GoalState = {
  id: "g1",
  objective: "Fix the tests",
  status: "active",
  rounds: 0,
  maxRounds: 50,
  updatedAt: 1,
};

function setup(goal: GoalState | null = null) {
  const deps = createTestAppContainer();
  const remote = { goal };
  const read = vi
    .spyOn(deps.goalService, "read")
    .mockImplementation(async () =>
      remote.goal ? { kind: "goal", goal: remote.goal } : { kind: "none" },
    );
  vi.spyOn(deps.goalService, "refresh").mockImplementation(async (sessionId) => {
    const result = await read(sessionId, "repo");
    if (result.kind === "goal" || result.kind === "none")
      deps.goalManager.apply(sessionId, result.kind === "goal" ? result.goal : null, false);
    return result;
  });
  const command = vi
    .spyOn(deps.goalService, "command")
    .mockImplementation(async (_id, _directory, text) => {
      remote.goal =
        text === "clear"
          ? null
          : text === "resume"
            ? { ...remote.goal!, status: "active" }
            : { ...initialGoal, objective: text };
      deps.goalManager.apply("s1", remote.goal, false);
      return { kind: "ok" };
    });
  const pause = vi.spyOn(deps.goalService, "pauseFromCommand").mockImplementation(async () => {
    remote.goal = { ...remote.goal!, status: "paused", reason: "Paused by the user" };
    deps.goalManager.apply("s1", remote.goal, false);
    return { kind: "paused", notice: { status: "paused", reason: "Paused by the user" } };
  });
  deps.goalManager.follow("s1");
  deps.goalManager.apply("s1", goal, false);
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  };
  deps.keyboardManager.initialize(api as never, 1);
  function context(text = "", data?: string) {
    return {
      api,
      match: "",
      chat: { id: 1 },
      message: { text },
      ...(data ? { callbackQuery: { data, message: { message_id: 42 } } } : {}),
      reply: vi.fn().mockResolvedValue({ message_id: 42 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandContext<Context>;
  }
  return { deps, remote, read, command, pause, context, api };
}

beforeEach(() => {
  mocked.session = { id: "s1", directory: "repo" };
  mocked.resolveAgent.mockReset().mockResolvedValue("build");
  mocked.model = { providerID: "selected", modelID: "chosen", variant: "high" };
});

describe("guided session goal", () => {
  it("uses the existing icon convention on input Cancel, Start and paused Delete", async () => {
    const { deps, context, remote, api } = setup();
    const input = context();
    await goalCommand(input, deps);
    expect(input.reply).toHaveBeenCalledWith(
      t("goal.input.prompt"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [expect.objectContaining({ text: "❌ Cancel", callback_data: "goal:cancel" })],
          ],
        }),
      }),
    );
    const objective = context("Fix tests");
    await handleGoalTextInput(objective, deps);
    expect(objective.reply).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              expect.objectContaining({ text: "✅ Start" }),
              expect.objectContaining({ text: "❌ Cancel" }),
            ],
          ],
        }),
      }),
    );
    await handleGoalCallback(context("", "goal:cancel"), deps);
    remote.goal = { ...initialGoal, status: "paused" };
    await goalCommand(context(), deps);
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [[expect.objectContaining({ text: "🗑 Delete goal" })]],
        }),
      }),
    );
  });

  it("confirms Continue with an icon and uses the model selected since the previous run", async () => {
    const { deps, context, command } = setup({ ...initialGoal, status: "paused" });
    mocked.model = { providerID: "other-provider", modelID: "other-model", variant: "default" };
    const resume = context(getGoalButtonLabels(deps.goalManager)[1]);
    await handleGoalButton(resume, deps);
    expect(resume.reply).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              expect.objectContaining({ text: "▶ Continue" }),
              expect.objectContaining({ text: "❌ Cancel" }),
            ],
          ],
        }),
      }),
    );
    await handleGoalCallback(context("", "goal:confirm"), deps);
    expect(command).toHaveBeenCalledExactlyOnceWith("s1", "repo", "resume", {
      agent: "build",
      model: { providerID: "other-provider", modelID: "other-model" },
      variant: "default",
    });
  });

  it("rechecks the session after resolving the project agent asynchronously", async () => {
    const { deps, context, command } = setup();
    await goalCommand(context(), deps);
    await handleGoalTextInput(context("Fix tests"), deps);
    let resolve!: (value: string) => void;
    mocked.resolveAgent.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const confirmation = handleGoalCallback(context("", "goal:confirm"), deps);
    mocked.session = { id: "s2", directory: "repo" };
    deps.goalManager.follow("s2");
    resolve("build");
    await confirmation;
    expect(command).not.toHaveBeenCalled();
    expect(deps.interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps confirmation answerable and reports an action error if agent resolution fails", async () => {
    const { deps, context, command } = setup();
    await goalCommand(context(), deps);
    await handleGoalTextInput(context("Fix tests"), deps);
    mocked.resolveAgent.mockRejectedValue(new Error("Unavailable project agent"));
    const confirmation = context("", "goal:confirm");
    await handleGoalCallback(confirmation, deps);
    expect(command).not.toHaveBeenCalled();
    expect(confirmation.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("goal.action_error"),
      show_alert: true,
    });
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("confirm");
  });

  it("asks for a separate objective, then starts only after confirmation", async () => {
    const { deps, context, command, api } = setup();
    const ctx = context();
    await goalCommand(ctx, deps);
    expect(ctx.reply).toHaveBeenCalledWith(t("goal.input.prompt"), expect.anything());
    expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("objective");
    await handleGoalTextInput(context("Fix all tests"), deps);
    expect(deps.interactionManager.getSnapshot()?.metadata.action).toBe("start");
    expect(command).not.toHaveBeenCalled();
    await handleGoalCallback(context("", "goal:confirm"), deps);
    expect(command).toHaveBeenCalledExactlyOnceWith("s1", "repo", "Fix all tests", {
      agent: "build",
      model: { providerID: "selected", modelID: "chosen" },
      variant: "high",
    });
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      1,
      expect.stringContaining("Fix all tests"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({ keyboard: expect.any(Array) }),
      }),
    );
    expect(deps.keyboardManager.getGoalLabels()[1]).toContain("Pause");
  });

  it.each(["  ", '"pause"', "‘RESUME’", "clear", "x".repeat(4001)])(
    "keeps invalid input open without calling the server (%s)",
    async (text) => {
      const { deps, context, command } = setup();
      await goalCommand(context(), deps);
      await handleGoalTextInput(context(text), deps);
      expect(deps.interactionManager.getSnapshot()?.metadata.stage).toBe("objective");
      expect(command).not.toHaveBeenCalled();
    },
  );

  it.each(["pause", "resume", "clear", "new objective"])(
    "refuses legacy command arguments: %s",
    async (argument) => {
      const { deps, context, read, command, api } = setup();
      const ctx = context();
      ctx.match = argument;
      await goalCommand(ctx, deps);
      expect(read).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledWith(
        1,
        t("goal.arguments_not_supported"),
        expect.anything(),
      );
    },
  );

  it("cancels objective input without creating a goal", async () => {
    const { deps, context, command } = setup();
    await goalCommand(context(), deps);
    await handleGoalCallback(context("", "goal:cancel"), deps);
    expect(deps.interactionManager.getSnapshot()).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it("shows existing details without a slot, even while busy", async () => {
    const { deps, context, api, command } = setup(initialGoal);
    vi.spyOn(deps.attachManager, "isBusy").mockReturnValue(true);
    await goalCommand(context(), deps);
    expect(api.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining(initialGoal.objective),
      expect.anything(),
    );
    expect(deps.interactionManager.getSnapshot()).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it("pauses directly while busy, updates its row and does not interrupt the turn", async () => {
    const { deps, context, pause, command, api } = setup(initialGoal);
    vi.spyOn(deps.attachManager, "isBusy").mockReturnValue(true);
    const ctx = context(getGoalButtonLabels(deps.goalManager)[1]);
    await handleGoalButton(ctx, deps);
    expect(pause).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.keyboardManager.getGoalLabels()[1]).toContain("Continue");
  });

  it("uses plain Pause for the current selected session after switching, without a visible ID", async () => {
    const { deps, remote, context, pause } = setup(initialGoal);
    const label = getGoalButtonLabels(deps.goalManager)[1]!;
    expect(label).toBe("⏸ Pause");
    mocked.session = { id: "s2", directory: "repo" };
    remote.goal = { ...initialGoal, id: "g2", objective: "Another goal" };
    deps.goalManager.follow("s2");
    deps.goalManager.apply("s2", remote.goal, false);
    await handleGoalButton(context(label), deps);
    expect(pause).toHaveBeenCalledExactlyOnceWith("s2", "repo");
  });

  it("invalidates a hidden start confirmation when a goal event arrives during its fresh read", async () => {
    const { deps, remote, read, context, command } = setup();
    await goalCommand(context(), deps);
    await handleGoalTextInput(context("New goal"), deps);
    let resolve!: (value: Awaited<ReturnType<typeof deps.goalService.read>>) => void;
    read.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const confirm = handleGoalCallback(context("", "goal:confirm"), deps);
    remote.goal = { ...initialGoal, id: "external" };
    deps.goalManager.apply("s1", remote.goal, false);
    resolve({ kind: "none" });
    await confirm;
    expect(command).not.toHaveBeenCalled();
    expect(deps.interactionManager.getSnapshot()).toBeNull();
  });

  it("requires confirmation for Continue and refuses an old button after a state change", async () => {
    const { deps, context, command, api } = setup({ ...initialGoal, status: "paused" });
    const old = getGoalButtonLabels(deps.goalManager)[1]!;
    await handleGoalButton(context(old), deps);
    expect(command).not.toHaveBeenCalled();
    await handleGoalCallback(context("", "goal:confirm"), deps);
    expect(command).toHaveBeenCalledExactlyOnceWith("s1", "repo", "resume", {
      agent: "build",
      model: { providerID: "selected", modelID: "chosen" },
      variant: "high",
    });
    await handleGoalButton(context(old), deps);
    expect(command).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      1,
      t("inline.inactive_callback"),
      expect.anything(),
    );
  });

  it.each(["paused", "complete"] as const)(
    "deletes an idle %s goal only once and removes the row",
    async (status) => {
      const { deps, context, command, api } = setup({ ...initialGoal, status });
      const token = deps.goalManager.getControlToken();
      if (status === "paused") await handleGoalCallback(context("", goalDeleteData(token)), deps);
      else await handleGoalButton(context(getGoalButtonLabels(deps.goalManager)[1]), deps);
      expect(command).toHaveBeenCalledExactlyOnceWith("s1", "repo", "clear");
      expect(deps.keyboardManager.getGoalLabels()).toEqual([]);
      expect(api.sendMessage).toHaveBeenLastCalledWith(1, t("goal.deleted"), expect.anything());
      await handleGoalCallback(context("", goalDeleteData(token)), deps);
      expect(command).toHaveBeenCalledTimes(1);
    },
  );

  it("does not delete an active goal through an inline callback", async () => {
    const { deps, context, command } = setup(initialGoal);
    await handleGoalCallback(context("", goalDeleteData(deps.goalManager.getControlToken())), deps);
    expect(command).not.toHaveBeenCalled();
  });

  it("does not create over a goal added outside Telegram during objective input", async () => {
    const { deps, remote, context, command } = setup();
    await goalCommand(context(), deps);
    remote.goal = initialGoal;
    await handleGoalTextInput(context("another goal"), deps);
    expect(command).not.toHaveBeenCalled();
    expect(deps.interactionManager.getSnapshot()).toBeNull();
  });

  it("preserves a known goal and its row after an explicit failed read", async () => {
    const { deps, read, context, api, pause } = setup(initialGoal);
    read.mockResolvedValue({ kind: "error", message: "network" });
    await handleGoalButton(context(getGoalButtonLabels(deps.goalManager)[1]), deps);
    expect(pause).not.toHaveBeenCalled();
    expect(deps.goalManager.snapshot().goal).toEqual(initialGoal);
    expect(api.sendMessage).toHaveBeenLastCalledWith(1, t("goal.read_error"), expect.anything());
  });

  it("rejects a control read that returns after switching sessions", async () => {
    const { deps, context, read, pause } = setup(initialGoal);
    let resolve!: (value: Awaited<ReturnType<typeof deps.goalService.read>>) => void;
    read.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const action = handleGoalButton(context(getGoalButtonLabels(deps.goalManager)[1]), deps);
    mocked.session = { id: "s2", directory: "repo" };
    deps.goalManager.follow("s2");
    resolve({ kind: "goal", goal: initialGoal });
    await action;
    expect(pause).not.toHaveBeenCalled();
    expect(deps.goalManager.snapshot()).toEqual({ sessionId: "s2", goal: null });
  });
});

describe("goal interaction routing", () => {
  it("allows busy read/Pause but blocks busy Continue/Delete and creation", () => {
    const { deps, context } = setup(initialGoal);
    vi.spyOn(deps.attachManager, "isBusy").mockReturnValue(true);
    for (const label of getGoalButtonLabels(deps.goalManager))
      expect(resolveInteractionGuardDecision(context(label), deps).allow).toBe(true);
    for (const status of ["paused", "complete"] as const) {
      deps.goalManager.apply("s1", { ...initialGoal, status }, false);
      expect(
        resolveInteractionGuardDecision(context(getGoalButtonLabels(deps.goalManager)[1]), deps)
          .allow,
      ).toBe(false);
    }
  });

  it("does not interpret goal buttons as objective input or custom question answers", () => {
    const { deps, context } = setup(initialGoal);
    const label = getGoalButtonLabels(deps.goalManager)[0]!;
    for (const expectedInput of ["text", "mixed", "callback"] as const) {
      deps.interactionManager.start({
        kind: "custom",
        expectedInput,
        metadata: { flow: "goal", stage: "objective" },
      });
      expect(resolveInteractionGuardDecision(context(label), deps).allow).toBe(false);
    }
  });

  it("refuses voice/media during input and permits its Cancel callback", async () => {
    const { deps, context } = setup();
    await goalCommand(context(), deps);
    const ctx = context();
    Object.assign(ctx, { message: { voice: { file_id: "voice" } } });
    const decision = resolveInteractionGuardDecision(ctx, deps);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(resolveInteractionGuardDecision(context("", "goal:cancel"), deps).allow).toBe(true);
  });
});
