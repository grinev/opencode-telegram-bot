import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { newCommand } from "../../../src/bot/commands/new-command.js";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  attachToSessionMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
    },
  },
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  setCurrentSession: vi.fn(),
}));

vi.mock("../../../src/app/services/session-cache-service.js", () => ({
  ingestSessionInfoForCache: vi.fn().mockResolvedValue(undefined),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: vi.fn(async (agentName?: string) => agentName ?? "build"),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
}));

vi.mock("../../../src/app/services/variant-selection-service.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

vi.mock("../../../src/bot/keyboards/main-reply-keyboard.js", () => ({
  createMainKeyboard: vi.fn(() => ({ keyboard: true })),
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  attachToSession: mocked.attachToSessionMock,
}));

function createContext(): Context {
  return {
    chat: { id: 123 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

function createDeps() {
  return {
    ...container,
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    resetInteractions: vi.fn(),
    keyboardManager: {
      initialize: vi.fn(),
      updateAgent: vi.fn(),
      getContextInfo: vi.fn(() => null),
    } as never,
    bot: { api: {} } as Bot<Context>,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/new", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.attachToSessionMock.mockReset();
    mocked.attachToSessionMock.mockResolvedValue({
      busy: false,
      alreadyAttached: false,
      restoredQuestion: false,
      restoredPermissions: 0,
    });
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo" });
  });

  it("blocks new session creation while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createContext();
    await newCommand(ctx as never, createDeps());

    expect(mocked.sessionCreateMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
  });

  it("creates and immediately follows the new session", async () => {
    mocked.sessionCreateMock.mockResolvedValueOnce({
      data: { id: "session-2", title: "Session Two" },
      error: null,
    });

    const ctx = createContext();
    await newCommand(ctx as never, createDeps());

    expect(mocked.attachToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bot: expect.any(Object),
        chatId: 123,
        session: {
          id: "session-2",
          title: "Session Two",
          directory: "/repo",
        },
        ensureEventSubscription: mocked.ensureEventSubscriptionMock,
      }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("new.created", { title: "Session Two" }),
      expect.objectContaining({
        reply_markup: { keyboard: true },
      }),
    );
  });
});
