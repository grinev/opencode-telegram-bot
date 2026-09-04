import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mocked = vi.hoisted(() => ({
  createBotMock: vi.fn(),
  cleanupBotRuntimeMock: vi.fn(),
  autoRestartStartMock: vi.fn(),
  autoRestartStopMock: vi.fn(),
  notifyOpencodeReadyIfHealthyMock: vi.fn(),
  registerOpenCodeReadyRefreshHandlerMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  flushSettingsMock: vi.fn(),
  scheduledTaskInitializeMock: vi.fn(),
  scheduledTaskShutdownMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  clearServiceStateFileMock: vi.fn(),
  isServiceChildProcessMock: vi.fn(),
  getServiceStateFilePathFromEnvMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  initializeLoggerMock: vi.fn(),
  getLogFilePathMock: vi.fn(),
  flushLoggerMock: vi.fn(),
  startHealthServerMock: vi.fn(),
  stopHealthServerMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
    telegram: {
      allowedUserId: 123,
    },
  },
}));

vi.mock("../../src/bot/index.js", () => ({
  cleanupBotRuntime: mocked.cleanupBotRuntimeMock,
  createBot: mocked.createBotMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    ...mocked.config,
    health: {
      port: 0,
    },
  },
}));

vi.mock("../../src/opencode/auto-restart.js", () => ({
  opencodeAutoRestartService: {
    start: mocked.autoRestartStartMock,
    stop: mocked.autoRestartStopMock,
  },
}));

vi.mock("../../src/opencode/ready-refresh.js", () => ({
  notifyOpencodeReadyIfHealthy: mocked.notifyOpencodeReadyIfHealthyMock,
  registerOpenCodeReadyRefreshHandler: mocked.registerOpenCodeReadyRefreshHandlerMock,
}));

vi.mock("../../src/app/stores/settings-store.js", () => ({
  flushSettings: mocked.flushSettingsMock,
  loadSettings: mocked.loadSettingsMock,
}));

vi.mock("../../src/app/services/scheduled-task-runtime-service.js", () => ({
  scheduledTaskRuntime: {
    initialize: mocked.scheduledTaskInitializeMock,
    shutdown: mocked.scheduledTaskShutdownMock,
  },
}));

vi.mock("../../src/app/services/model-selection-service.js", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
}));

vi.mock("../../src/runtime/mode.js", () => ({
  getRuntimeMode: () => "source",
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: () => ({ envFilePath: ".env" }),
}));

vi.mock("../../src/runtime/service/manager.js", () => ({
  clearServiceStateFile: mocked.clearServiceStateFileMock,
}));

vi.mock("../../src/runtime/service/env.js", () => ({
  getServiceStateFilePathFromEnv: mocked.getServiceStateFilePathFromEnvMock,
  isServiceChildProcess: mocked.isServiceChildProcessMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogFilePath: mocked.getLogFilePathMock,
  initializeLogger: mocked.initializeLoggerMock,
  flushLogger: mocked.flushLoggerMock,
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("../../src/health/server.js", () => ({
  startHealthServer: mocked.startHealthServerMock,
  stopHealthServer: mocked.stopHealthServerMock,
}));

import { startBotApp } from "../../src/app/bootstrap/start-bot-app.js";
import { defined } from "../helpers/defined.js";

function createBot() {
  return {
    api: {
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "" }),
    },
    start: vi.fn().mockImplementation(async ({ onStart }) => {
      onStart?.({ username: "test_bot" });
    }),
    stop: vi.fn(),
  };
}

// Unlike createBot(), this one keeps bot.start() pending so the process handlers
// stay registered while the test exercises them.
function createPendingBot() {
  let releaseStart: () => void = () => undefined;

  const bot = {
    api: {
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "" }),
    },
    start: vi.fn().mockImplementation(async ({ onStart }) => {
      onStart?.({ username: "test_bot" });
      await new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
    }),
    stop: vi.fn(),
  };

  return { bot, releaseStart: () => releaseStart() };
}

async function flushBackgroundTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("app/start-bot-app", () => {
  const registeredProcessHandlers = new Map<string, (...args: unknown[]) => void>();
  let processExitSpy: MockInstance;

  function expectHandler(event: string): (...args: unknown[]) => void {
    const handler = registeredProcessHandlers.get(event);
    if (!handler) {
      throw new Error(`No handler registered for "${event}"`);
    }

    return handler;
  }

  async function startAppWithPendingBot() {
    const { bot, releaseStart } = createPendingBot();
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    // bot.start() runs after every handler registration, so this also means the
    // handlers are captured and releaseStart is wired up.
    await vi.waitFor(() => {
      expect(bot.start).toHaveBeenCalledTimes(1);
    });

    return { bot, releaseStart, appPromise };
  }

  beforeEach(() => {
    mocked.createBotMock.mockReset();
    mocked.cleanupBotRuntimeMock.mockReset();
    mocked.autoRestartStartMock.mockReset();
    mocked.autoRestartStopMock.mockReset();
    mocked.notifyOpencodeReadyIfHealthyMock.mockReset();
    mocked.registerOpenCodeReadyRefreshHandlerMock.mockReset();
    mocked.loadSettingsMock.mockReset();
    mocked.flushSettingsMock.mockReset();
    mocked.scheduledTaskInitializeMock.mockReset();
    mocked.scheduledTaskShutdownMock.mockReset();
    mocked.reconcileStoredModelSelectionMock.mockReset();
    mocked.clearServiceStateFileMock.mockReset();
    mocked.isServiceChildProcessMock.mockReset();
    mocked.getServiceStateFilePathFromEnvMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.initializeLoggerMock.mockReset();
    mocked.getLogFilePathMock.mockReset();
    mocked.flushLoggerMock.mockReset();

    mocked.createBotMock.mockReturnValue(createBot());
    mocked.autoRestartStartMock.mockResolvedValue(false);
    mocked.notifyOpencodeReadyIfHealthyMock.mockResolvedValue(false);
    mocked.loadSettingsMock.mockResolvedValue(undefined);
    mocked.flushSettingsMock.mockResolvedValue(undefined);
    mocked.scheduledTaskInitializeMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
    mocked.isServiceChildProcessMock.mockReturnValue(false);
    mocked.initializeLoggerMock.mockResolvedValue(undefined);
    mocked.getLogFilePathMock.mockReturnValue(null);
    mocked.flushLoggerMock.mockResolvedValue(undefined);

    registeredProcessHandlers.clear();
    vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      registeredProcessHandlers.set(event, handler);
      return process;
    }) as unknown as typeof process.on);
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as typeof process.exit);
  });

  it("registers ready refresh and performs startup health notification", async () => {
    await startBotApp();
    await flushBackgroundTasks();

    expect(mocked.registerOpenCodeReadyRefreshHandlerMock).toHaveBeenCalledTimes(1);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
    expect(mocked.startHealthServerMock).toHaveBeenCalledTimes(1);
    expect(mocked.startHealthServerMock).toHaveBeenCalledWith(0, expect.any(String));
  });

  it("runs startup health notification even when auto-restart handled startup", async () => {
    mocked.autoRestartStartMock.mockResolvedValue(true);

    await startBotApp();
    await flushBackgroundTasks();

    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
    expect(mocked.startHealthServerMock).toHaveBeenCalledTimes(1);
  });

  it("starts Telegram polling without waiting for OpenCode startup checks", async () => {
    let resolveAutoRestart: (value: boolean) => void = () => undefined;
    mocked.autoRestartStartMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAutoRestart = resolve;
      }),
    );
    const bot = createBot();
    mocked.createBotMock.mockReturnValue(bot);

    await startBotApp();

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).not.toHaveBeenCalled();
    expect(mocked.startHealthServerMock).toHaveBeenCalledTimes(1);

    resolveAutoRestart(false);
    await flushBackgroundTasks();
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });

  it("logs an unhandled rejection and keeps the process alive", async () => {
    const { releaseStart, appPromise } = await startAppWithPendingBot();
    const reason = new Error("background task failed");

    expectHandler("unhandledRejection")(reason);
    // The old implementation exited only after a microtask tick, so the flush is
    // what makes this assertion catch a reintroduced process.exit.
    await flushBackgroundTasks();

    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[App] Unhandled promise rejection",
      reason,
    );
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(mocked.clearServiceStateFileMock).not.toHaveBeenCalled();

    releaseStart();
    await appPromise;
  });

  it("survives repeated unhandled rejections", async () => {
    const { releaseStart, appPromise } = await startAppWithPendingBot();
    const handler = expectHandler("unhandledRejection");

    handler(new Error("first"));
    handler(new Error("second"));
    handler(new Error("third"));
    await flushBackgroundTasks();

    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(3);
    expect(processExitSpy).not.toHaveBeenCalled();

    releaseStart();
    await appPromise;
  });

  it("flushes settings before exiting on uncaught exception", async () => {
    let resolveFlush: () => void = () => undefined;
    mocked.flushSettingsMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFlush = resolve;
      }),
    );
    const { releaseStart, appPromise } = await startAppWithPendingBot();

    expectHandler("uncaughtException")(new Error("boom"));
    await vi.waitFor(() => {
      expect(mocked.flushSettingsMock).toHaveBeenCalledTimes(1);
    });

    expect(processExitSpy).not.toHaveBeenCalled();

    resolveFlush();
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    releaseStart();
    await appPromise;
  });

  it("exits on uncaught exception even when clearing service state fails", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-service-state-"));
    const stateFilePath = path.join(stateDir, "bot-service.json");
    await writeFile(stateFilePath, "{}");
    mocked.isServiceChildProcessMock.mockReturnValue(true);
    mocked.getServiceStateFilePathFromEnvMock.mockReturnValue(stateFilePath);
    mocked.clearServiceStateFileMock.mockRejectedValue(new Error("state file is locked"));

    const { releaseStart, appPromise } = await startAppWithPendingBot();

    expectHandler("uncaughtException")(new Error("boom"));
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    // Without the catch around clearManagedServiceState the rejection would skip
    // the rest of the chain, so the flush is what proves the guard is in place.
    expect(mocked.flushSettingsMock).toHaveBeenCalledTimes(1);

    releaseStart();
    await appPromise;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("flushes the log file after settings on uncaught exception", async () => {
    const { releaseStart, appPromise } = await startAppWithPendingBot();

    expectHandler("uncaughtException")(new Error("boom"));
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    expect(mocked.flushLoggerMock).toHaveBeenCalledTimes(1);
    expect(defined(mocked.flushLoggerMock.mock.invocationCallOrder[0])).toBeGreaterThan(
      defined(mocked.flushSettingsMock.mock.invocationCallOrder[0]),
    );

    releaseStart();
    await appPromise;
  });

  it("flushes the log file after settings before the forced shutdown exit", async () => {
    const { releaseStart, appPromise } = await startAppWithPendingBot();

    vi.useFakeTimers();
    expectHandler("SIGINT")();
    await vi.advanceTimersByTimeAsync(5000);
    await flushBackgroundTasks();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining("forcing exit"));
    expect(mocked.flushSettingsMock).toHaveBeenCalledTimes(1);
    expect(mocked.flushLoggerMock).toHaveBeenCalledTimes(1);
    expect(defined(mocked.flushLoggerMock.mock.invocationCallOrder[0])).toBeGreaterThan(
      defined(mocked.flushSettingsMock.mock.invocationCallOrder[0]),
    );
    expect(processExitSpy).toHaveBeenCalledWith(0);

    vi.useRealTimers();
    releaseStart();
    await appPromise;
  });

  it("flushes settings before the forced shutdown exit", async () => {
    const { releaseStart, appPromise } = await startAppWithPendingBot();

    vi.useFakeTimers();
    expectHandler("SIGINT")();
    await vi.advanceTimersByTimeAsync(5000);
    await flushBackgroundTasks();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining("forcing exit"));
    expect(mocked.flushSettingsMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);

    vi.useRealTimers();
    releaseStart();
    await appPromise;
  });

  it("flushes settings after the scheduler shuts down on normal exit", async () => {
    await startBotApp();

    expect(mocked.flushSettingsMock).toHaveBeenCalledTimes(1);
    expect(defined(mocked.flushSettingsMock.mock.invocationCallOrder[0])).toBeGreaterThan(
      defined(mocked.scheduledTaskShutdownMock.mock.invocationCallOrder[0]),
    );
    expect(mocked.stopHealthServerMock).toHaveBeenCalledTimes(1);
  });
});
