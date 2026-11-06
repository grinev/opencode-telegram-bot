import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHome } from "../../helpers/test-environment.js";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import {
  __resetSettingsForTests,
  flushSettings,
  loadSettings,
  setCurrentProject,
} from "../../../src/app/stores/settings-store.js";
import {
  addScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  toggleScheduledTask,
} from "../../../src/app/stores/scheduled-task-store.js";
import {
  cleanupScheduledTaskSessionIgnores,
  isScheduledTaskSessionIgnored,
  registerScheduledTaskSessionIgnore,
  removeScheduledTaskSessionIgnore,
} from "../../../src/app/services/scheduled-task-session-ignore-service.js";
import type { ScheduledTask } from "../../../src/app/types/scheduled-task.js";

function createScheduledTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    kind: "cron",
    projectId: "project-1",
    projectWorktree: "D:/Projects/Repo",
    agent: "build",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    },
    scheduleText: "every 5 minutes",
    scheduleSummary: "Every 5 minutes",
    timezone: "UTC",
    cron: "*/5 * * * *",
    enabled: true,
    prompt: "Check repository status",
    createdAt: "2026-03-15T10:00:00.000Z",
    nextRunAt: "2026-03-15T10:05:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
    ...overrides,
  } as ScheduledTask;
}

describe("app/stores/scheduled-task-store", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await createTestHome("opencode-telegram-task-store-");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");
    __resetSettingsForTests();
    await loadSettings();
  });

  afterEach(async () => {
    await flushSettings();
    __resetSettingsForTests();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true });
  });

  it("persists scheduled tasks to settings.json", async () => {
    const task = createScheduledTask();

    await addScheduledTask(task);

    expect(listScheduledTasks()).toEqual([task]);

    const settingsPath = path.join(tempHome, "settings.json");
    const settingsFile = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      scheduledTasks?: ScheduledTask[];
    };

    expect(settingsFile.scheduledTasks).toEqual([task]);
  });

  it("backfills the agent for legacy tasks persisted without it", async () => {
    const legacyTask = createScheduledTask();
    Reflect.deleteProperty(legacyTask, "agent");

    await addScheduledTask(legacyTask);

    expect(listScheduledTasks()[0]).toMatchObject({
      id: "task-1",
      agent: "build",
    });
  });

  it("persists a disabled cron task and schedules only a future occurrence when enabled", async () => {
    await addScheduledTask(createScheduledTask());
    const disabled = await toggleScheduledTask("task-1", false);
    expect(disabled).toMatchObject({ enabled: false, nextRunAt: null, runCount: 0 });
    __resetSettingsForTests();
    await loadSettings();
    expect(listScheduledTasks()[0]).toMatchObject({ enabled: false, nextRunAt: null });
    const before = Date.now();
    const enabled = await toggleScheduledTask("task-1", true);
    expect(enabled).toMatchObject({ enabled: true, runCount: 0 });
    expect(enabled).toMatchObject({ activationPending: true });
    expect(Date.parse(enabled?.nextRunAt ?? "")).toBeGreaterThan(before);
  });

  it("keeps task and unrelated settings on a real write failure and allows a later retry", async () => {
    await addScheduledTask(createScheduledTask());
    setCurrentProject({ id: "project", worktree: "/project" });
    await flushSettings();
    const tempPath = path.join(tempHome, "settings.json.tmp");
    await mkdir(tempPath);
    await expect(toggleScheduledTask("task-1", false)).rejects.toThrow();
    expect(listScheduledTasks()[0]).toMatchObject({ enabled: true });
    const file = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf8"));
    expect(file.scheduledTasks[0].enabled).toBe(true);
    await rm(tempPath, { recursive: true });
    await toggleScheduledTask("task-1", false);
    const saved = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf8"));
    expect(saved.scheduledTasks[0].enabled).toBe(false);
    expect(saved.currentProject).toMatchObject({ id: "project", worktree: "/project" });
  });

  it("ignores a repeated request for the same scheduling state", async () => {
    await addScheduledTask(createScheduledTask());
    await toggleScheduledTask("task-1", false);
    expect(await toggleScheduledTask("task-1", false)).toBeNull();
    expect(listScheduledTasks()[0]).toMatchObject({ enabled: false });
  });

  it("defaults a legacy cron task to enabled", async () => {
    const legacy = createScheduledTask();
    Reflect.deleteProperty(legacy, "enabled");
    await addScheduledTask(legacy);
    expect(listScheduledTasks()[0]).toMatchObject({ enabled: true });
  });

  it("removes scheduled task from persisted storage", async () => {
    const firstTask = createScheduledTask();
    const secondTask = createScheduledTask({
      id: "task-2",
      kind: "once",
      scheduleText: "tomorrow at 12:00",
      scheduleSummary: "Tomorrow at 12:00",
      runAt: "2026-03-16T12:00:00.000Z",
      cron: undefined,
      nextRunAt: "2026-03-16T12:00:00.000Z",
    });

    await addScheduledTask(firstTask);
    await addScheduledTask(secondTask);

    await removeScheduledTask("task-1");

    expect(listScheduledTasks()).toEqual([secondTask]);
  });

  it("persists scheduled task session ignores and prunes stale entries", async () => {
    await registerScheduledTaskSessionIgnore("fresh-session", new Date("2026-03-16T10:00:00.000Z"));
    await registerScheduledTaskSessionIgnore("stale-session", new Date("2026-03-15T09:59:59.000Z"));

    expect(
      isScheduledTaskSessionIgnored("fresh-session", new Date("2026-03-16T12:00:00.000Z")),
    ).toBe(true);
    expect(
      isScheduledTaskSessionIgnored("stale-session", new Date("2026-03-16T12:00:00.000Z")),
    ).toBe(false);

    const removed = await cleanupScheduledTaskSessionIgnores(new Date("2026-03-16T12:00:00.000Z"));

    expect(removed).toBe(1);

    const settingsPath = path.join(tempHome, "settings.json");
    const settingsFile = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      scheduledTaskSessionIgnores?: Array<{ sessionId: string; createdAt: string }>;
    };
    expect(settingsFile.scheduledTaskSessionIgnores).toEqual([
      { sessionId: "fresh-session", createdAt: "2026-03-16T10:00:00.000Z" },
    ]);

    await removeScheduledTaskSessionIgnore("fresh-session");

    expect(
      isScheduledTaskSessionIgnored("fresh-session", new Date("2026-03-16T12:00:00.000Z")),
    ).toBe(false);
  });
});
