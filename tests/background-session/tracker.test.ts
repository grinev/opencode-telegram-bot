import type { Event } from "@opencode-ai/sdk/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundSessionTracker } from "../../src/background-session/tracker.js";

const mocked = vi.hoisted(() => ({
  isScheduledTaskSessionIgnoredMock: vi.fn(() => false),
}));

vi.mock("../../src/scheduled-task/session-ignore.js", () => ({
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
