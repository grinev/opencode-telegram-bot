import { describe, expect, it } from "vitest";
import { formatTaskListBadge } from "../../src/scheduled-task/display.js";
import type { ScheduledTask } from "../../src/scheduled-task/types.js";

function createCronTask(cron: string): ScheduledTask {
  return {
    id: "task-cron",
    kind: "cron",
    cron,
    projectId: "project-id",
    projectWorktree: "D:\\Projects\\Repo",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: null,
    },
    scheduleText: cron,
    scheduleSummary: "summary",
    timezone: "UTC",
    prompt: "prompt",
    createdAt: "2026-03-16T10:00:00.000Z",
    nextRunAt: "2026-03-16T11:00:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
  };
}

function createOnceTask(runAt: string): ScheduledTask {
  return {
    id: "task-once",
    kind: "once",
    runAt,
    projectId: "project-id",
    projectWorktree: "D:\\Projects\\Repo",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: null,
    },
    scheduleText: runAt,
    scheduleSummary: "summary",
    timezone: "UTC",
    prompt: "prompt",
    createdAt: "2026-03-16T10:00:00.000Z",
    nextRunAt: runAt,
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
  };
}

describe("scheduled-task/display", () => {
  it("formats one-time tasks with a compact date badge", () => {
    const currentYear = new Date().getUTCFullYear();
    const task = createOnceTask(`${currentYear}-03-20T14:30:00.000Z`);

    expect(formatTaskListBadge(task)).toBe("20 Mar 14:30");
  });

  it("includes the year for one-time tasks outside the current year", () => {
    const task = createOnceTask("2099-03-20T14:30:00.000Z");

    expect(formatTaskListBadge(task)).toBe("20 Mar 2099 14:30");
  });

  it("formats simple recurring minute intervals", () => {
    expect(formatTaskListBadge(createCronTask("*/5 * * * *"))).toBe("5m");
  });

  it("formats recurring hour intervals with minute offsets", () => {
    expect(formatTaskListBadge(createCronTask("15 */2 * * *"))).toBe("2h :15");
  });

  it("formats hourly recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("30 * * * *"))).toBe("hourly :30");
  });

  it("formats daily recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("0 9 * * *"))).toBe("daily 09:00");
  });

  it("formats single weekday recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("0 10 * * 1"))).toBe("Mon 10:00");
  });

  it("formats weekday recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("0 9 * * 1-5"))).toBe("weekdays 09:00");
  });

  it("formats weekend recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("0 11 * * 0,6"))).toBe("weekends 11:00");
  });

  it("formats monthly recurring tasks", () => {
    expect(formatTaskListBadge(createCronTask("30 12 15 * *"))).toBe("monthly 15 12:30");
  });

  it("falls back to cron for complex recurring expressions", () => {
    expect(formatTaskListBadge(createCronTask("0 9 * * 1,3,5"))).toBe("cron");
  });
});
