import { describe, expect, it } from "vitest";
import {
  computeNextCronRunAt,
  computeNextRunAt,
  isTaskDue,
} from "../../src/scheduled-task/next-run.js";
import type { ScheduledTask } from "../../src/scheduled-task/types.js";

describe("scheduled-task/next-run", () => {
  it("computes next daily cron run in UTC", () => {
    const nextRunAt = computeNextCronRunAt(
      "0 17 * * *",
      "UTC",
      new Date("2026-03-16T16:20:00.000Z"),
    );

    expect(nextRunAt).toBe("2026-03-16T17:00:00.000Z");
  });

  it("computes next weekly cron run in UTC", () => {
    const nextRunAt = computeNextCronRunAt(
      "30 9 * * 1",
      "UTC",
      new Date("2026-03-16T09:31:00.000Z"),
    );

    expect(nextRunAt).toBe("2026-03-23T09:30:00.000Z");
  });

  it("returns null for one-time task after its run date", () => {
    const task: ScheduledTask = {
      id: "task-1",
      kind: "once",
      projectId: "project-1",
      projectWorktree: "D:\\Projects\\Repo",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      },
      scheduleText: "tomorrow at noon",
      scheduleSummary: "Tomorrow at 12:00",
      timezone: "UTC",
      prompt: "Send a report",
      createdAt: "2026-03-16T10:00:00.000Z",
      runAt: "2026-03-17T12:00:00.000Z",
      nextRunAt: "2026-03-17T12:00:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
    };

    expect(computeNextRunAt(task, new Date("2026-03-17T12:01:00.000Z"))).toBeNull();
  });

  it("detects due tasks from nextRunAt", () => {
    const task: ScheduledTask = {
      id: "task-2",
      kind: "cron",
      projectId: "project-1",
      projectWorktree: "D:\\Projects\\Repo",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      },
      scheduleText: "every day at 17:00",
      scheduleSummary: "Every day at 17:00",
      timezone: "UTC",
      cron: "0 17 * * *",
      prompt: "Send a report",
      createdAt: "2026-03-16T10:00:00.000Z",
      nextRunAt: "2026-03-16T17:00:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
    };

    expect(isTaskDue(task, new Date("2026-03-16T17:00:00.000Z"))).toBe(true);
    expect(isTaskDue(task, new Date("2026-03-16T16:59:00.000Z"))).toBe(false);
  });
});
