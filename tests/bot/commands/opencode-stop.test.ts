import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  resolveLocalOpencodeTargetMock: vi.fn(),
  findServerPidMock: vi.fn(),
  killServerProcessMock: vi.fn(),
  editBotTextMock: vi.fn(),
  loggerInfoMock: vi.fn(),
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
  findServerPid: mocked.findServerPidMock,
  killServerProcess: mocked.killServerProcessMock,
}));

vi.mock("../../../src/bot/messages/telegram-text.js", () => ({
  editBotText: mocked.editBotTextMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: mocked.loggerInfoMock,
    error: mocked.loggerErrorMock,
  },
}));

import { opencodeStopCommand } from "../../../src/bot/commands/opencode-stop-command.js";

function createContext(): Context {
  return {
    chat: { id: 42, type: "private" },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 11 }),
  } as unknown as Context;
}

describe("bot/commands/opencode-stop-command", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.resolveLocalOpencodeTargetMock.mockReset();
    mocked.findServerPidMock.mockReset();
    mocked.killServerProcessMock.mockReset();
    mocked.editBotTextMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.editBotTextMock.mockResolvedValue(undefined);
  });

  it("warns when OPENCODE_API_URL points to a remote server", async () => {
    const ctx = createContext();
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);

    await opencodeStopCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.remote_configured"));
    expect(mocked.findServerPidMock).not.toHaveBeenCalled();
  });

  it("reports not_running when health-check fails", async () => {
    const ctx = createContext();
    mocked.healthMock.mockRejectedValue(new Error("offline"));

    await opencodeStopCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.not_running"));
    expect(mocked.findServerPidMock).not.toHaveBeenCalled();
  });

  it("reports pid_not_found when server is healthy but no process is found", async () => {
    const ctx = createContext();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.2.3" }, error: null });
    mocked.findServerPidMock.mockResolvedValue(null);

    await opencodeStopCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.pid_not_found", { port: 4096 }));
    expect(mocked.killServerProcessMock).not.toHaveBeenCalled();
  });

  it("stops the process found on the configured port", async () => {
    const ctx = createContext();
    mocked.healthMock
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null })
      .mockRejectedValueOnce(new Error("offline"));
    mocked.findServerPidMock.mockResolvedValue(456);
    mocked.killServerProcessMock.mockResolvedValue(true);

    await opencodeStopCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.stopping", { pid: 456 }));
    expect(mocked.killServerProcessMock).toHaveBeenCalledWith(456, 5000);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: t("opencode_stop.success") }),
    );
  });

  it("reports stop_error when process termination fails", async () => {
    const ctx = createContext();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.2.3" }, error: null });
    mocked.findServerPidMock.mockResolvedValue(456);
    mocked.killServerProcessMock.mockResolvedValue(false);

    await opencodeStopCommand(ctx as never);

    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_stop.stop_error", { error: t("common.unknown_error") }),
      }),
    );
  });
});
