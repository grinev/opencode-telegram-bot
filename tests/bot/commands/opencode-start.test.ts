import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  resolveLocalOpencodeTargetMock: vi.fn(),
  startLocalOpencodeServerMock: vi.fn(),
  notifyReadyMock: vi.fn(),
  editBotTextMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("../../../src/opencode/process.js", () => ({
  resolveLocalOpencodeTarget: mocked.resolveLocalOpencodeTargetMock,
  startLocalOpencodeServer: mocked.startLocalOpencodeServerMock,
}));

vi.mock("../../../src/bot/utils/telegram-text.js", () => ({
  editBotText: mocked.editBotTextMock,
}));

vi.mock("../../../src/opencode/ready-lifecycle.js", () => ({
  opencodeReadyLifecycle: {
    notifyReady: mocked.notifyReadyMock,
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { opencodeStartCommand } from "../../../src/bot/commands/opencode-start.js";

function createContext(): Context {
  return {
    chat: { id: 42, type: "private" },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as Context;
}

function createChildProcess(pid: number): ChildProcess {
  return {
    pid,
    once: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

describe("bot/commands/opencode-start", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.resolveLocalOpencodeTargetMock.mockReset();
    mocked.startLocalOpencodeServerMock.mockReset();
    mocked.notifyReadyMock.mockReset();
    mocked.editBotTextMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.notifyReadyMock.mockResolvedValue(true);
    mocked.editBotTextMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns when OPENCODE_API_URL points to a remote server", async () => {
    const ctx = createContext();
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);

    await opencodeStartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_start.remote_configured"));
    expect(mocked.startLocalOpencodeServerMock).not.toHaveBeenCalled();
  });

  it("reports that the server is already running when health-check succeeds", async () => {
    const ctx = createContext();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_start.already_running", { version: "1.2.3" }),
    );
    expect(mocked.startLocalOpencodeServerMock).not.toHaveBeenCalled();
    expect(mocked.notifyReadyMock).toHaveBeenCalledWith("opencode_start_already_running");
  });

  it("starts the local server and reports success", async () => {
    const ctx = createContext();
    const childProcess = createChildProcess(123);
    mocked.startLocalOpencodeServerMock.mockReturnValue(childProcess);
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledWith({
      host: "localhost",
      port: 4096,
    });
    expect(childProcess.unref).toHaveBeenCalledTimes(1);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_start.success", { pid: 123, version: "1.2.3" }),
      }),
    );
    expect(mocked.notifyReadyMock).toHaveBeenCalledWith("opencode_start_success");
  });

  it("reports command error when ready lifecycle fails unexpectedly", async () => {
    const ctx = createContext();
    const childProcess = createChildProcess(123);
    mocked.startLocalOpencodeServerMock.mockReturnValue(childProcess);
    mocked.notifyReadyMock.mockRejectedValueOnce(new Error("ready failed"));
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[Bot] Error in /opencode-start command:",
      expect.any(Error),
    );
  });

  it("reports started_not_ready when the server does not answer in time", async () => {
    vi.useFakeTimers();

    const ctx = createContext();
    const childProcess = createChildProcess(321);
    mocked.startLocalOpencodeServerMock.mockReturnValue(childProcess);
    mocked.healthMock.mockRejectedValue(new Error("offline"));

    const commandPromise = opencodeStartCommand(ctx as never);
    await vi.advanceTimersByTimeAsync(10_500);
    await commandPromise;

    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_start.started_not_ready", { pid: 321 }),
      }),
    );
    expect(mocked.notifyReadyMock).not.toHaveBeenCalled();
  });
});
