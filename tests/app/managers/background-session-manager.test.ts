import type { Event } from "@opencode-ai/sdk/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundSessionTracker } from "../../../src/app/managers/background-session-manager.js";

const mocked = vi.hoisted(() => ({
  isScheduledTaskSessionIgnoredMock: vi.fn((_sessionId: string) => false),
}));

vi.mock("../../../src/app/services/scheduled-task-session-ignore-service.js", () => ({
  isScheduledTaskSessionIgnored: mocked.isScheduledTaskSessionIgnoredMock,
}));

function event(value: unknown): Event {
  return value as Event;
}

async function flushNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

describe("BackgroundSessionTracker", () => {
  beforeEach(() => {
    mocked.isScheduledTaskSessionIgnoredMock.mockReturnValue(false);
  });

  it("notifies once when a background session becomes idle after an assistant message completes", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "session.updated",
        properties: { info: { id: "session-2", title: "Background Task" } },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "message.updated",
        properties: {
          info: {
            id: "message-1",
            sessionID: "session-2",
            role: "assistant",
            time: { completed: 123 },
          },
        },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).not.toHaveBeenCalled();

    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "session-2" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).toHaveBeenCalledWith({
      kind: "assistant_response",
      sessionId: "session-2",
      sessionTitle: "Background Task",
      messageId: "message-1",
    });
  });

  it("does not notify for the current session", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "message.updated",
        properties: {
          info: {
            id: "message-1",
            sessionID: "session-1",
            role: "assistant",
            time: { completed: 123 },
          },
        },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "session-1" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("coalesces multiple completed assistant messages into one idle notification", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);
    const firstCompletedEvent = event({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-2",
          role: "assistant",
          time: { completed: 123 },
        },
      },
    });
    const secondCompletedEvent = event({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-2",
          role: "assistant",
          time: { completed: 456 },
        },
      },
    });

    tracker.processEvent(firstCompletedEvent, "session-1");
    tracker.processEvent(firstCompletedEvent, "session-1");
    tracker.processEvent(secondCompletedEvent, "session-1");
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "session-2" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "message-2" }),
    );
  });

  it("notifies about background questions and permissions", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "question.asked",
        properties: { id: "question-1", sessionID: "session-2", questions: [] },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "permission.asked",
        properties: { id: "permission-1", sessionID: "session-2", permission: "bash" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).toHaveBeenCalledWith({
      kind: "question_asked",
      sessionId: "session-2",
      sessionTitle: undefined,
      requestId: "question-1",
    });
    expect(onNotification).toHaveBeenCalledWith({
      kind: "permission_asked",
      sessionId: "session-2",
      sessionTitle: undefined,
      requestId: "permission-1",
    });
  });

  it("deduplicates question and permission request ids", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);
    const questionEvent = event({
      type: "question.asked",
      properties: { id: "question-1", sessionID: "session-2", questions: [] },
    });
    const permissionEvent = event({
      type: "permission.asked",
      properties: { id: "permission-1", sessionID: "session-2", permission: "bash" },
    });

    tracker.processEvent(questionEvent, "session-1");
    tracker.processEvent(questionEvent, "session-1");
    tracker.processEvent(permissionEvent, "session-1");
    tracker.processEvent(permissionEvent, "session-1");

    await flushNotifications();

    expect(onNotification).toHaveBeenCalledTimes(2);
  });

  it("ignores child sessions to avoid duplicate subagent notifications", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "session.created",
        properties: { info: { id: "child-1", parentID: "session-1", title: "Subagent" } },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "message.updated",
        properties: {
          info: {
            id: "message-1",
            sessionID: "child-1",
            role: "assistant",
            time: { completed: 123 },
          },
        },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "child-1" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("ignores scheduled task sessions", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);
    mocked.isScheduledTaskSessionIgnoredMock.mockImplementation(
      (sessionId: string) => sessionId === "scheduled-session",
    );

    tracker.processEvent(
      event({
        type: "message.updated",
        properties: {
          info: {
            id: "message-1",
            sessionID: "scheduled-session",
            role: "assistant",
            time: { completed: 123 },
          },
        },
      }),
      "session-1",
    );
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "scheduled-session" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("clears dedupe state when the directory changes", async () => {
    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);
    const completedEvent = event({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-2",
          role: "assistant",
          time: { completed: 123 },
        },
      },
    });

    tracker.setDirectory("D:/repo-a");
    tracker.processEvent(completedEvent, "session-1");
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "session-2" },
      }),
      "session-1",
    );
    tracker.setDirectory("D:/repo-b");
    tracker.processEvent(completedEvent, "session-1");
    tracker.processEvent(
      event({
        type: "session.idle",
        properties: { sessionID: "session-2" },
      }),
      "session-1",
    );

    await flushNotifications();

    expect(onNotification).toHaveBeenCalledTimes(2);
  });
});

// Synthetic ids only - never real Telegram uids.
const MULTI_OP_PRIMARY_USER_ID = 111;
const MULTI_OP_SECONDARY_USER_ID = 222;

describe("BackgroundSessionTracker multi-operator ownership", () => {
  /**
   * Fresh module registry so the frozen `config.telegram` allowlist matches
   * the env stubbed here (the file-level import above keeps its solo default).
   */
  async function loadScopedModules() {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(MULTI_OP_PRIMARY_USER_ID));
    vi.stubEnv(
      "TELEGRAM_ALLOWED_USER_IDS",
      `${MULTI_OP_PRIMARY_USER_ID},${MULTI_OP_SECONDARY_USER_ID}`,
    );
    vi.resetModules();
    const [{ BackgroundSessionTracker }, { userScope }, settingsStore] = await Promise.all([
      import("../../../src/app/managers/background-session-manager.js"),
      import("../../../src/app/stores/user-scope.js"),
      import("../../../src/app/stores/settings-store.js"),
    ]);
    return { BackgroundSessionTracker, userScope, settingsStore };
  }

  it("ignores sessions bound to an operator instead of demoting them to notifications", async () => {
    const { BackgroundSessionTracker, userScope, settingsStore } = await loadScopedModules();

    // Operator 222 owns their foreground tape.
    await userScope.run({ userId: MULTI_OP_SECONDARY_USER_ID }, async () => {
      settingsStore.setCurrentSession({
        id: "bound-session-1",
        title: "Operator 222 tape",
        directory: "D:/repo",
      });
    });

    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "permission.asked",
        properties: { id: "req-bound", sessionID: "bound-session-1" },
      }),
      null,
    );
    await flushNotifications();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("still notifies for genuinely unowned sessions", async () => {
    const { BackgroundSessionTracker } = await loadScopedModules();

    const tracker = new BackgroundSessionTracker();
    const onNotification = vi.fn();
    tracker.setOnNotification(onNotification);

    tracker.processEvent(
      event({
        type: "permission.asked",
        properties: { id: "req-unbound", sessionID: "unbound-session-1" },
      }),
      null,
    );
    await flushNotifications();

    expect(onNotification).toHaveBeenCalledWith({
      kind: "permission_asked",
      sessionId: "unbound-session-1",
      sessionTitle: undefined,
      requestId: "req-unbound",
    });
  });
});
