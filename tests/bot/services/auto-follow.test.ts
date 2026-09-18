import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

/**
 * Auto-follow: when a session starts running while the bot is idle on another
 * session, follow it - same project directly, different KNOWN project by
 * switching the bot's selected project first.
 *
 * settings-store & session-service are REAL here: state flows through their
 * public API (setCurrentProject / setCurrentSession / getCurrent*) so the test
 * exercises the same persistence path production uses.
 */

const mocked = vi.hoisted(() => ({
  subscribeCallbacks: [] as Array<{ id: number; cb: (event: Event) => void }>,
  subscribeCounter: 0,
  subscribeToEvents: vi.fn(async (_d: string, cb: (event: Event) => void) => {
    const id = ++mocked.subscribeCounter;
    mocked.subscribeCallbacks.push({ id, cb });
  }),
  stopEventListening: vi.fn(),
  stopAllSessionEvents: vi.fn(),
  allEventsCallback: null as ((event: Event) => void) | null,
  subscribeToAllSessionEvents: vi.fn(async (cb: (event: Event) => void) => {
    mocked.allEventsCallback = cb;
  }),
  sessionGetMock: vi.fn(),
  getProjectByWorktreeMock: vi.fn(),
  attachToSessionMock: vi.fn(async () => ({
    busy: true,
    alreadyAttached: false,
    restoredQuestion: false,
    restoredPermissions: 0,
  })),
  markAttachedSessionBusyMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  isForegroundBusyMock: vi.fn(() => false),
  interactionSnapshot: null as { kind: string } | null,
  clearAllInteractionStateMock: vi.fn(),
  sendMessageApiMock: vi.fn(async () => ({ message_id: 77 })),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

vi.mock("../../../src/opencode/all-events.js", () => ({
  subscribeToAllSessionEvents: mocked.subscribeToAllSessionEvents,
  stopAllSessionEvents: mocked.stopAllSessionEvents,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      get: mocked.sessionGetMock,
      messages: vi.fn(async () => ({ data: [], error: undefined })),
      status: vi.fn(async () => ({ data: {}, error: undefined })),
    },
    question: { list: vi.fn(async () => ({ data: [], error: undefined })) },
    permission: { list: vi.fn(async () => ({ data: [], error: undefined })) },
    app: { agents: vi.fn(async () => ({ data: [], error: undefined })) },
    global: { event: vi.fn() },
  },
}));

vi.mock("../../../src/app/services/session-cache-service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ingestSessionInfoForCache: vi.fn(async () => undefined),
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjectByWorktree: mocked.getProjectByWorktreeMock,
  getProjects: vi.fn(async () => []),
  getProjectById: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  resolveProjectAgent: vi.fn(async (a?: string) => a ?? "build"),
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  attachToSession: mocked.attachToSessionMock,
  markAttachedSessionBusy: mocked.markAttachedSessionBusyMock,
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
  detachAttachedSession: mocked.detachAttachedSessionMock,
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("../../../src/app/managers/interaction-manager.js", () => ({
  interactionManager: {
    getSnapshot: vi.fn(() => mocked.interactionSnapshot),
    start: vi.fn(),
    clear: vi.fn(),
  },
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function makeBot() {
  const api = new Proxy({}, {
    get(target: Record<string, unknown>, prop: string | symbol) {
      if (prop === "sendMessage") return mocked.sendMessageApiMock;
      if (typeof prop !== "string") return undefined;
      target[prop] ??= vi.fn(async () => ({ message_id: 1 }));
      return target[prop];
    },
  });
  return { api } as unknown as import("grammy").Bot<import("grammy").Context>;
}

function emitBusy(sessionId: string): void {
  const cb =
    mocked.allEventsCallback ??
    mocked.subscribeCallbacks[mocked.subscribeCallbacks.length - 1]?.cb;
  if (!cb) return;
  cb({
    type: "session.status",
    properties: { status: { type: "busy" }, sessionID: sessionId },
  } as unknown as Event);
}

async function settle(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

let desiredAutoFollow = "true";

describe("auto-follow active session", () => {
  let activeService: { cleanup(reason: string): void } | null = null;
  let stores: typeof import("../../../src/app/stores/settings-store.js");
  let sessions: typeof import("../../../src/app/services/session-service.js");

  beforeEach(async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fsp = await import("node:fs/promises");
    process.env.OPENCODE_TELEGRAM_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), "autofollow-"));
    process.env.AUTO_FOLLOW_ACTIVE_SESSION = desiredAutoFollow;
    const { setRuntimeMode } = await import("../../../src/runtime/mode.js");
    setRuntimeMode("installed");

    stores = await import("../../../src/app/stores/settings-store.js");
    sessions = await import("../../../src/app/services/session-service.js");
    await stores.__resetSettingsForTests();

    stores.setCurrentProject({ id: "p1", worktree: "D:/repo", name: "Repo" });
    sessions.setCurrentSession({ id: "session-current", title: "Current", directory: "D:/repo" });

    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-active", title: "Active run", directory: "D:/repo" },
      error: undefined,
    });
    mocked.getProjectByWorktreeMock.mockRejectedValue(new Error("not found"));
    mocked.isForegroundBusyMock.mockReturnValue(false);
    mocked.interactionSnapshot = null;

    const { createEventSubscriptionService } = await import(
      "../../../src/bot/services/event-subscription-service.js"
    );
    const service = createEventSubscriptionService();
    activeService = service;
    service.setTelegramContext(makeBot(), 123456789);
    await service.ensureEventSubscription("D:/repo");
    desiredAutoFollow = "true";
  });

  afterEach(async () => {
    delete process.env.AUTO_FOLLOW_ACTIVE_SESSION;
    activeService?.cleanup("test_cleanup");
    activeService = null;
    await new Promise((r) => setTimeout(r, 25));
    vi.resetModules();
  });

  it("follows a busy session in the same project", async () => {
    emitBusy("session-active");
    await settle();

    expect(sessions.getCurrentSession()).toEqual(
      expect.objectContaining({ id: "session-active", directory: "D:/repo" }),
    );
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ id: "session-active" }) }),
    );
    expect(mocked.sendMessageApiMock).toHaveBeenCalledWith(
      123456789,
      expect.stringContaining("Repo"),
      expect.objectContaining({ disable_notification: true }),
    );
  });

  it("ignores busy events for the current session itself", async () => {
    emitBusy("session-current");
    await settle();

    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(sessions.getCurrentSession()?.id).toBe("session-current");
  });

  it("does not switch while the bot runs its own prompt", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    emitBusy("session-active");
    await settle();

    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(sessions.getCurrentSession()?.id).toBe("session-current");
  });

  it("does not switch while an interaction is pending", async () => {
    mocked.interactionSnapshot = { kind: "permission" };
    emitBusy("session-active");
    await settle();

    expect(sessions.getCurrentSession()?.id).toBe("session-current");
  });

  it("skips sessions outside every known project", async () => {
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-x", title: "X", directory: "E:/unknown" },
      error: undefined,
    });
    emitBusy("session-x");
    await settle();

    expect(sessions.getCurrentSession()?.id).toBe("session-current");
    expect(mocked.attachToSessionMock).not.toHaveBeenCalled();
  });



  it("is disabled via AUTO_FOLLOW_ACTIVE_SESSION=false", async () => {
    const { config } = await import("../../../src/config.js");
    const original = config.bot.autoFollowActiveSession;
    Object.assign(config.bot, { autoFollowActiveSession: false });
    try {
      emitBusy("session-active");
      await settle();

      expect(sessions.getCurrentSession()?.id).toBe("session-current");
      expect(mocked.attachToSessionMock).not.toHaveBeenCalled();
    } finally {
      Object.assign(config.bot, { autoFollowActiveSession: original });
    }
  });

  it("switches PROJECT when the busy session belongs to another known project", async () => {
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-x", title: "X", directory: "E:/other" },
      error: undefined,
    });
    mocked.getProjectByWorktreeMock.mockResolvedValue({
      id: "p2",
      worktree: "E:/other",
      name: "OtherProj",
    });

    emitBusy("session-x");
    await settle();

    expect(stores.getCurrentProject()).toEqual(
      expect.objectContaining({ id: "p2", worktree: "E:/other", name: "OtherProj" }),
    );
    expect(sessions.getCurrentSession()).toEqual(
      expect.objectContaining({ id: "session-x", directory: "E:/other" }),
    );
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ directory: "E:/other" }) }),
    );
    expect(mocked.sendMessageApiMock).toHaveBeenCalledWith(
      123456789,
      expect.stringContaining("OtherProj"),
      expect.anything(),
    );
  });
});
