import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createBotMock: vi.fn(),
  cleanupBotRuntimeMock: vi.fn(),
  autoRestartStartMock: vi.fn(),
  autoRestartStopMock: vi.fn(),
  notifyOpencodeReadyIfHealthyMock: vi.fn(),
  registerOpenCodeReadyRefreshHandlerMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  scheduledTaskInitializeMock: vi.fn(),
  scheduledTaskShutdownMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  clearServiceStateFileMock: vi.fn(),
  isServiceChildProcessMock: vi.fn(),
  getServiceStateFilePathFromEnvMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  initializeLoggerMock: vi.fn(),
  getLogFilePathMock: vi.fn(),
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
  config: mocked.config,
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

vi.mock("../../src/settings/manager.js", () => ({
  loadSettings: mocked.loadSettingsMock,
}));

vi.mock("../../src/scheduled-task/runtime.js", () => ({
  scheduledTaskRuntime: {
    initialize: mocked.scheduledTaskInitializeMock,
    shutdown: mocked.scheduledTaskShutdownMock,
  },
}));

vi.mock("../../src/model/manager.js", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
}));

vi.mock("../../src/runtime/mode.js", () => ({
  getRuntimeMode: () => "source",
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: () => ({ envFilePath: ".env" }),
}));

vi.mock("../../src/service/manager.js", () => ({
  clearServiceStateFile: mocked.clearServiceStateFileMock,
}));

vi.mock("../../src/service/runtime.js", () => ({
  getServiceStateFilePathFromEnv: mocked.getServiceStateFilePathFromEnvMock,
  isServiceChildProcess: mocked.isServiceChildProcessMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogFilePath: mocked.getLogFilePathMock,
  initializeLogger: mocked.initializeLoggerMock,
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
  },
}));

import { startBotApp } from "../../src/app/start-bot-app.js";

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

describe("app/start-bot-app", () => {
  beforeEach(() => {
    mocked.createBotMock.mockReset();
    mocked.cleanupBotRuntimeMock.mockReset();
    mocked.autoRestartStartMock.mockReset();
    mocked.autoRestartStopMock.mockReset();
    mocked.notifyOpencodeReadyIfHealthyMock.mockReset();
    mocked.registerOpenCodeReadyRefreshHandlerMock.mockReset();
    mocked.loadSettingsMock.mockReset();
    mocked.scheduledTaskInitializeMock.mockReset();
    mocked.scheduledTaskShutdownMock.mockReset();
    mocked.reconcileStoredModelSelectionMock.mockReset();
    mocked.clearServiceStateFileMock.mockReset();
    mocked.isServiceChildProcessMock.mockReset();
    mocked.getServiceStateFilePathFromEnvMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.initializeLoggerMock.mockReset();
    mocked.getLogFilePathMock.mockReset();

    mocked.createBotMock.mockReturnValue(createBot());
    mocked.autoRestartStartMock.mockResolvedValue(false);
    mocked.notifyOpencodeReadyIfHealthyMock.mockResolvedValue(false);
    mocked.loadSettingsMock.mockResolvedValue(undefined);
    mocked.scheduledTaskInitializeMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
    mocked.isServiceChildProcessMock.mockReturnValue(false);
    mocked.initializeLoggerMock.mockResolvedValue(undefined);
    mocked.getLogFilePathMock.mockReturnValue(null);
  });

  it("registers ready refresh and performs startup health notification", async () => {
    await startBotApp();

    expect(mocked.registerOpenCodeReadyRefreshHandlerMock).toHaveBeenCalledTimes(1);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });

  it("runs startup health notification even when auto-restart handled startup", async () => {
    mocked.autoRestartStartMock.mockResolvedValue(true);

    await startBotApp();

    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });
});
