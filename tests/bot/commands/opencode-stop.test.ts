import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const mocked = vi.hoisted(() => ({
  resolveLocalOpencodeTargetMock: vi.fn(),
  findServerPidMock: vi.fn(),
  killServerProcessMock: vi.fn(),
  editBotTextMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  clearRuntimeStateMock: vi.fn(),
  getBusySessionsMock: vi.fn(),
  clearAllForegroundMock: vi.fn(),
  attachGetSnapshotMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
  notifyUnavailableMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
  },
}));

vi.mock("#src/config.ts", () => ({
  config: mocked.config,
}));

vi.mock("#src/opencode/process.ts", () => ({
  resolveLocalOpencodeTarget: mocked.resolveLocalOpencodeTargetMock,
  createOpencodeServeSpawnCommand: vi.fn(),
  startLocalOpencodeServer: vi.fn(),
  findWindowsListeningPidInNetstat: vi.fn(),
  findUnixListeningPidInSs: vi.fn(),
  findServerPid: mocked.findServerPidMock,
  killServerProcess: mocked.killServerProcessMock,
}));

vi.mock("#src/opencode/ready-lifecycle.ts", () => ({
  opencodeReadyLifecycle: {
    notifyUnavailable: mocked.notifyUnavailableMock,
  },
}));

vi.mock("#src/bot/messages/telegram-text.ts", () => ({
  getTelegramRenderedPartSignature: vi.fn(),
  sendBotText: vi.fn().mockResolvedValue(undefined),
  sendRenderedBotPart: vi.fn().mockResolvedValue(undefined),
  editRenderedBotPart: vi.fn().mockResolvedValue(undefined),
  sendDraftBotPart: vi.fn().mockResolvedValue(undefined),
  completeDraftPart: vi.fn().mockResolvedValue(undefined),
  editBotText: mocked.editBotTextMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: vi.fn(),
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("#src/app/managers/foreground-session-state-manager.ts", () => ({
  foregroundSessionState: {
    getBusySessions: mocked.getBusySessionsMock,
    clearAll: mocked.clearAllForegroundMock,
  },
}));

vi.mock("#src/app/managers/attach-manager.ts", () => ({
  attachManager: {
    getSnapshot: mocked.attachGetSnapshotMock,
  },
}));

vi.mock("#src/app/services/attach-service.ts", () => ({
  configureAttachPresentation: vi.fn(),
  attachToSession: vi.fn(),
  restoreAttachedCurrentSession: vi.fn(),
  detachAttachedSession: vi.fn(),
  markAttachedSessionBusy: vi.fn(),
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
}));

vi.mock("#src/bot/handlers/prompt.ts", () => ({
  getPromptBotInstance: vi.fn(),
  getPromptChatId: vi.fn(),
  setPromptResponseMode: vi.fn(),
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
  consumePromptResponseMode: vi.fn(),
  processUserPrompt: vi.fn().mockResolvedValue(undefined),
}));

const { opencodeStopCommand } = await loadSut<typeof import("#src/bot/commands/opencode-stop-command.js")>(
  "#src/bot/commands/opencode-stop-command.ts",
  import.meta.url,
);
const { promptQueue } = await loadSut<typeof import("#src/app/managers/prompt-queue-manager.js")>(
  "#src/app/managers/prompt-queue-manager.ts",
  import.meta.url,
);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
import { createIncomingPrompt } from "#src/app/types/prompt.js";

function createContext(): Context {
  return {
    chat: { id: 42, type: "private" },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 11 }),
  } as unknown as Context;
}

function createDeps() {
  return { clearRuntimeState: mocked.clearRuntimeStateMock };
}

describe("bot/commands/opencode-stop-command", () => {
  beforeEach(() => {
    mocked.resolveLocalOpencodeTargetMock.mockReset();
    mocked.findServerPidMock.mockReset();
    mocked.killServerProcessMock.mockReset();
    mocked.editBotTextMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.clearRuntimeStateMock.mockReset();
    mocked.getBusySessionsMock.mockReset();
    mocked.clearAllForegroundMock.mockReset();
    mocked.attachGetSnapshotMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockReset();
    mocked.clearPromptResponseModeMock.mockReset();
    mocked.notifyUnavailableMock.mockReset();
    promptQueue.__resetForTests();
    interactionManager.clear("test_setup");

    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.editBotTextMock.mockResolvedValue(undefined);
    mocked.getBusySessionsMock.mockReturnValue([]);
    mocked.attachGetSnapshotMock.mockReturnValue(null);
    mocked.markAttachedSessionIdleMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("warns when running in a container even if the API URL is local", async () => {
    const ctx = createContext();
    vi.stubEnv("OPENCODE_TELEGRAM_CONTAINER", "1");

    await opencodeStopCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.container.command_unavailable"));
    expect(mocked.findServerPidMock).not.toHaveBeenCalled();
    expect(mocked.resolveLocalOpencodeTargetMock).not.toHaveBeenCalled();
    expect(mocked.clearRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("warns when OPENCODE_API_URL points to a remote server", async () => {
    const ctx = createContext();
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);

    await opencodeStopCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.remote_configured"));
    expect(mocked.findServerPidMock).not.toHaveBeenCalled();
    expect(mocked.clearRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("reports not_running when no local process is found", async () => {
    const ctx = createContext();
    mocked.findServerPidMock.mockResolvedValue(null);

    await opencodeStopCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.not_running"));
    expect(mocked.killServerProcessMock).not.toHaveBeenCalled();
    expect(mocked.clearRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("stops the process found on the configured port without a health check", async () => {
    const ctx = createContext();
    mocked.findServerPidMock.mockResolvedValue(456);
    mocked.killServerProcessMock.mockResolvedValue(true);

    await opencodeStopCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.stopping", { pid: 456 }));
    expect(mocked.killServerProcessMock).toHaveBeenCalledWith(456, 5000);
    expect(mocked.clearRuntimeStateMock).toHaveBeenCalledWith("opencode_stop");
    expect(mocked.clearAllForegroundMock).toHaveBeenCalledWith("opencode_stop");
    expect(promptQueue.size()).toBe(0);
    expect(interactionManager.isActive()).toBe(false);
    expect(mocked.notifyUnavailableMock).toHaveBeenCalledWith("opencode_stop");
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: t("opencode_stop.success") }),
    );
  });

  it("clears busy sessions and attached state after a successful stop", async () => {
    const ctx = createContext();
    mocked.findServerPidMock.mockResolvedValue(456);
    mocked.killServerProcessMock.mockResolvedValue(true);
    mocked.getBusySessionsMock.mockReturnValue([
      { sessionId: "session-1", directory: "D:/repo", markedAt: 1 },
      { sessionId: "session-2", directory: "D:/repo", markedAt: 2 },
    ]);
    mocked.attachGetSnapshotMock.mockReturnValue({
      sessionId: "session-1",
      directory: "D:/repo",
      busy: true,
    });
    promptQueue.add(createIncomingPrompt("queued after hang"));
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    await opencodeStopCommand(ctx as never, createDeps());

    expect(promptQueue.size()).toBe(0);
    expect(interactionManager.isActive()).toBe(false);

    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-2");
  });

  it("reports stop_error and skips cleanup when process termination fails", async () => {
    const ctx = createContext();
    mocked.findServerPidMock.mockResolvedValue(456);
    mocked.killServerProcessMock.mockResolvedValue(false);

    await opencodeStopCommand(ctx as never, createDeps());

    expect(mocked.clearRuntimeStateMock).not.toHaveBeenCalled();
    expect(mocked.clearAllForegroundMock).not.toHaveBeenCalled();
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_stop.stop_error", { error: t("common.unknown_error") }),
      }),
    );
  });
});
