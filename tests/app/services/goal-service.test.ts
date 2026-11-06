import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalManager } from "../../../src/app/managers/goal-manager.js";
import { GoalService } from "../../../src/app/services/goal-service.js";

const client = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn() }));
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeServerVersion: "v2",
  opencodeV2Client: { goal: client },
}));
const goal = {
  id: "g1",
  objective: "Fix tests",
  status: "active" as const,
  rounds: 0,
  maxRounds: 50,
  updatedAt: 1,
};

beforeEach(() => {
  client.get.mockReset();
  client.command.mockReset();
});

describe("goal service mobile controls", () => {
  it("forwards selected run context and retains goal capability after a selection error", async () => {
    const manager = new GoalManager();
    manager.follow("s1");
    manager.apply("s1", goal, false);
    const service = new GoalService(manager);
    client.get.mockResolvedValue({ data: goal });
    await service.read("s1", "repo");
    const selection = {
      agent: "plan",
      model: { providerID: "selected", modelID: "chosen" },
      variant: "high",
    };
    client.command.mockResolvedValueOnce({
      error: { name: "GoalSelectionError", cause: new Error("Selection failed") },
    });
    expect(await service.command("s1", "repo", "Fix tests", selection)).toEqual({
      kind: "error",
      message: "Selection failed",
    });
    expect(client.command).toHaveBeenLastCalledWith({
      sessionID: "s1",
      directory: "repo",
      text: "Fix tests",
      ...selection,
    });
    client.command.mockResolvedValue({ data: true });
    client.get.mockResolvedValue({ data: { ...goal, status: "paused" } });
    expect(await service.pauseForAbort("s1", "repo")).toMatchObject({ kind: "paused" });
    expect(client.command).toHaveBeenLastCalledWith({
      sessionID: "s1",
      directory: "repo",
      text: "pause",
    });
  });

  it.each(["replacement", "resume"])(
    "ignores a stale pause read after a newer %s event",
    async (change) => {
      const manager = new GoalManager();
      manager.follow("s1");
      manager.apply("s1", goal, false);
      const service = new GoalService(manager);
      const notice = vi.fn();
      service.setOnNotice(notice);
      client.command.mockResolvedValue({ data: undefined });
      let resolve!: (value: unknown) => void;
      client.get.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const pause = service.pauseFromCommand("s1", "repo");
      await vi.waitFor(() => expect(client.get).toHaveBeenCalledOnce());
      manager.apply("s1", { ...goal, status: "paused", updatedAt: 2 }, false);
      const current = { ...goal, id: change === "replacement" ? "g2" : goal.id, updatedAt: 3 };
      manager.apply("s1", current, false);
      const token = manager.getControlToken();
      resolve({ data: { ...goal, status: "paused", updatedAt: 2 } });
      expect(await pause).toEqual({ kind: "error" });
      expect(manager.snapshot().goal).toEqual(current);
      expect(manager.getControlToken()).toBe(token);
      expect(notice).not.toHaveBeenCalled();
    },
  );

  it("accepts its own paused SSE snapshot while the read is pending without a second notice", async () => {
    const manager = new GoalManager();
    manager.follow("s1");
    manager.apply("s1", goal, false);
    const service = new GoalService(manager);
    client.command.mockResolvedValue({ data: undefined });
    let resolve!: (value: unknown) => void;
    client.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pause = service.pauseFromCommand("s1", "repo");
    await vi.waitFor(() => expect(client.get).toHaveBeenCalledOnce());
    const paused = { ...goal, status: "paused" as const, updatedAt: 2 };
    await service.applyChanged("s1", paused);
    resolve({ data: paused });
    expect(await pause).toMatchObject({ kind: "paused" });
    expect(manager.snapshot().goal).toEqual(paused);
  });

  it("does not regress a newer event snapshot with an older concurrent read", async () => {
    const manager = new GoalManager();
    manager.follow("s1");
    manager.apply("s1", goal, false);
    const service = new GoalService(manager);
    let resolve!: (value: unknown) => void;
    client.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const refresh = service.refresh("s1", "repo", false);
    const paused = { ...goal, status: "paused" as const, updatedAt: 2 };
    manager.apply("s1", paused, false);
    resolve({ data: goal });
    expect(await refresh).toEqual({ kind: "goal", goal: paused });
    expect(manager.snapshot().goal).toEqual(paused);
  });

  it("does not claim pause success or change the row when the following read fails", async () => {
    const manager = new GoalManager();
    manager.follow("s1");
    manager.apply("s1", goal, false);
    const service = new GoalService(manager);
    const notice = vi.fn();
    service.setOnNotice(notice);
    client.command.mockResolvedValue({ data: undefined });
    client.get.mockResolvedValue({ error: new Error("network") });
    expect(await service.pauseFromCommand("s1", "repo")).toEqual({ kind: "error" });
    expect(manager.snapshot().goal?.status).toBe("active");
    expect(notice).not.toHaveBeenCalled();
  });

  it("cannot follow again from a late refresh after local detach", async () => {
    const manager = new GoalManager();
    manager.follow("s1");
    const service = new GoalService(manager);
    let resolve!: (value: unknown) => void;
    client.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const refresh = service.refresh("s1", "repo", false);
    manager.clear();
    resolve({ data: goal });
    await refresh;
    expect(manager.snapshot()).toEqual({ sessionId: null, goal: null });
    client.get.mockResolvedValue({ data: goal });
    await service.refresh("s1", "repo", false);
    expect(manager.snapshot()).toEqual({ sessionId: null, goal: null });
  });
});
