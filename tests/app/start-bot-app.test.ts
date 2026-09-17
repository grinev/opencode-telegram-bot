import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mocked = vi.hoisted(() => ({
  createBotMock: vi.fn(),
  cleanupProcessMock: vi.fn(),
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
  restoreFollowedSessionOnPollingStartMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
    telegram: {
      allowedUserId: 123,
    },
  },
}));

const container = vi.hoisted(() => ({
  cleanupProcess: mocked.cleanupProcessMock,
  opencodeAutoRestartService: {
    start: mocked.autoRestartStartMock,
    stop: mocked.autoRestartStopMock,
  },
  scheduledTaskRuntime: {
    initialize: mocked.scheduledTaskInitializeMock,
    shutdown: mocked.scheduledTaskShutdownMock,
  },
}));

vi.mock("../../src/app/bootstrap/app-container.js", () => ({
  createAppContainer: () => container,
}));

vi.mock("../../src/bot/index.js", () => ({
  createBot: mocked.createBotMock,
  restoreFollowedSessionOnPollingStart: mocked.restoreFollowedSessionOnPollingStartMock,
}));

vi.mock("../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("../../src/opencode/ready-refresh.js", () => ({
  notifyOpencodeReadyIfHealthy: mocked.notifyOpencodeReadyIfHealthyMock,
  registerOpenCodeReadyRefreshHandler: mocked.registerOpenCodeReadyRefreshHandlerMock,
}));

vi.mock("../../src/app/stores/settings-store.js", () => ({
  flushSettings: mocked.flushSettingsMock,
  loadSettings: mocked.loadSettingsMock,
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

import { startBotApp } from "../../src/app/bootstrap/start-bot-app.js";
import { defined } from "../helpers/defined.js";

function createBot() {
  return {
    api: {
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
      getMe: vi.fn().mockResolvedValue({ username: "test_bot" }),
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
      getMe: vi.fn().mockResolvedValue({ username: "test_bot" }),
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
    mocked.cleanupProcessMock.mockReset();
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
    mocked.restoreFollowedSessionOnPollingStartMock.mockReset();

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
    expect(mocked.registerOpenCodeReadyRefreshHandlerMock).toHaveBeenCalledWith(container);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup", container);
  });

  it("runs startup health notification even when auto-restart handled startup", async () => {
    mocked.autoRestartStartMock.mockResolvedValue(true);

    await startBotApp();
    await flushBackgroundTasks();

    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup", container);
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

    resolveAutoRestart(false);
    await flushBackgroundTasks();
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup", container);
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

  it("cleans up the container runtime beside auto-restart and the scheduler on SIGINT", async () => {
    const { bot, releaseStart, appPromise } = await startAppWithPendingBot();

    expectHandler("SIGINT")();

    expect(mocked.cleanupProcessMock).toHaveBeenCalledWith("app_shutdown_sigint");
    expect(mocked.autoRestartStopMock).toHaveBeenCalledTimes(1);
    expect(mocked.scheduledTaskShutdownMock).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);

    releaseStart();
    await appPromise;

    expect(mocked.cleanupProcessMock).toHaveBeenLastCalledWith("app_shutdown_complete");
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
  });

  it("retries getWebhookInfo on a network error then starts polling", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const networkError = Object.assign(new Error("Network request for 'getWebhookInfo' failed!"), {
      name: "HttpError",
    });
    bot.api.getWebhookInfo
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ url: "" });
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.api.getWebhookInfo).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[App] Telegram getWebhookInfo failed (attempt 1); retrying in 1000ms",
      networkError,
    );

    vi.useRealTimers();
  });

  it("retries a 501 server error then starts polling", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const serverError = Object.assign(new Error("Call to 'getWebhookInfo' failed! (501: Not Implemented)"), {
      error_code: 501,
    });
    bot.api.getWebhookInfo.mockRejectedValueOnce(serverError).mockResolvedValueOnce({ url: "" });
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.api.getWebhookInfo).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("caps a 429 retry_after at 60 seconds", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const rateLimitError = Object.assign(
      new Error("Call to 'getWebhookInfo' failed! (429: Too Many Requests)"),
      {
        error_code: 429,
        parameters: { retry_after: 120 },
      },
    );
    bot.api.getWebhookInfo.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({ url: "" });
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(bot.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[App] Telegram getWebhookInfo failed (attempt 1); retrying in 60000ms",
      rateLimitError,
    );

    vi.useRealTimers();
  });

  it("retries getMe on a network error then starts polling", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const networkError = Object.assign(new Error("Network request for 'getMe' failed!"), {
      name: "HttpError",
    });
    bot.api.getMe.mockRejectedValueOnce(networkError).mockResolvedValueOnce({ username: "test_bot" });
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.api.getMe).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[App] Telegram getMe failed (attempt 1); retrying in 1000ms",
      networkError,
    );

    vi.useRealTimers();
  });

  it("retries getWebhookInfo on a 5xx error then starts polling", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const serverError = Object.assign(new Error("Call to 'getWebhookInfo' failed! (502: Bad Gateway)"), {
      error_code: 502,
    });
    bot.api.getWebhookInfo.mockRejectedValueOnce(serverError).mockResolvedValueOnce({ url: "" });
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.api.getWebhookInfo).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("retries deleteWebhook on a network error then starts polling", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const networkError = Object.assign(new Error("Network request for 'deleteWebhook' failed!"), {
      name: "HttpError",
    });
    bot.api.getWebhookInfo.mockResolvedValue({ url: "https://example.invalid/hook", pending_update_count: 0 });
    bot.api.deleteWebhook.mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined);
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.api.deleteWebhook).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[App] Telegram deleteWebhook failed (attempt 1); retrying in 1000ms",
      networkError,
    );

    vi.useRealTimers();
  });

  it("does not retry a rejected bot token and never starts polling", async () => {
    const bot = createBot();
    const tokenError = Object.assign(new Error("Call to 'getWebhookInfo' failed! (401: Unauthorized)"), {
      error_code: 401,
    });
    bot.api.getWebhookInfo.mockRejectedValue(tokenError);
    mocked.createBotMock.mockReturnValue(bot);

    await expect(startBotApp()).rejects.toBe(tokenError);

    expect(bot.api.getWebhookInfo).toHaveBeenCalledTimes(1);
    expect(bot.start).not.toHaveBeenCalled();
    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[App] Telegram rejected the bot token; not retrying",
      tokenError,
    );
  });

  it("does not retry a 404 token error", async () => {
    const bot = createBot();
    const tokenError = Object.assign(new Error("Call to 'getWebhookInfo' failed! (404: Not Found)"), {
      error_code: 404,
    });
    bot.api.getWebhookInfo.mockRejectedValue(tokenError);
    mocked.createBotMock.mockReturnValue(bot);

    await expect(startBotApp()).rejects.toBe(tokenError);
    expect(bot.start).not.toHaveBeenCalled();
  });

  it("does not retry other Telegram startup errors", async () => {
    const bot = createBot();
    const conflictError = Object.assign(new Error("Call to 'getWebhookInfo' failed! (409: Conflict)"), {
      error_code: 409,
    });
    bot.api.getWebhookInfo.mockRejectedValue(conflictError);
    mocked.createBotMock.mockReturnValue(bot);

    await expect(startBotApp()).rejects.toBe(conflictError);
    expect(bot.start).not.toHaveBeenCalled();
    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[App] Telegram startup failed; not retrying",
      conflictError,
    );
  });

  it("caps the retry delay at 60 seconds", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const networkError = Object.assign(new Error("Network request for 'getWebhookInfo' failed!"), {
      name: "HttpError",
    });
    bot.api.getWebhookInfo.mockRejectedValue(networkError);
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[App] Telegram getWebhookInfo failed (attempt 7); retrying in 60000ms",
      networkError,
    );
    expect(bot.start).not.toHaveBeenCalled();

    bot.api.getWebhookInfo.mockResolvedValueOnce({ url: "" });
    await vi.advanceTimersByTimeAsync(60_000);
    await appPromise;
    expect(bot.start).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("does not start polling when shutdown begins during a retry wait", async () => {
    vi.useFakeTimers();
    const bot = createBot();
    const networkError = Object.assign(new Error("Network request for 'getWebhookInfo' failed!"), {
      name: "HttpError",
    });
    bot.api.getWebhookInfo.mockRejectedValue(networkError);
    mocked.createBotMock.mockReturnValue(bot);

    const appPromise = startBotApp();
    await vi.waitFor(() => {
      expect(mocked.loggerWarnMock).toHaveBeenCalled();
    });

    expectHandler("SIGINT")();
    await vi.advanceTimersByTimeAsync(1000);
    await appPromise;

    expect(bot.start).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("restores the followed session when polling starts", async () => {
    const bot = createBot();
    mocked.createBotMock.mockReturnValue(bot);

    await startBotApp();

    expect(mocked.createBotMock).toHaveBeenCalledWith(container, expect.anything());
    expect(bot).toMatchObject({ botInfo: { username: "test_bot" } });
    expect(mocked.restoreFollowedSessionOnPollingStartMock).toHaveBeenCalledWith(bot, container);
  });
});
