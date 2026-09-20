import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { subscribeMock } = vi.hoisted(() => {
  return {
    subscribeMock: vi.fn(),
  };
});

vi.mock("../../src/opencode/client.js", () => ({
  opencodeV2: {
    event: {
      subscribe: subscribeMock,
    },
  },
}));

import {
  __setSseIdleTimeoutForTests,
  stopEventListening,
  subscribeToEvents,
} from "../../src/opencode/events.js";
import { logger } from "../../src/utils/logger.js";
import { defined } from "../helpers/defined.js";

function createStream<T>(events: T[]): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createOpenStream(): AsyncGenerator<unknown, void, unknown> {
  return (async function* () {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDelayedOpenStream<T>(event: T, delayMs: number): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield event;

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDeferredStream<T>(eventPromise: Promise<T>): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    yield await eventPromise;
  })();
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// v2 SSE envelope: { type, data, location? }. Unknown types pass through with
// properties = data; the bot managers consume the {type, properties} shape.
function makeV2Event(
  type: string,
  data: Record<string, unknown> = {},
  directory: string | null = "D:/repo",
) {
  return directory === null ? { type, data } : { type, data, location: { directory } };
}

describe("opencode/events", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
  });

  afterEach(() => {
    stopEventListening();
    __setSseIdleTimeoutForTests(30_000);
    vi.useRealTimers();
  });

  it("subscribes to stream and forwards events to callback", async () => {
    const eventA = makeV2Event("session.status", { sessionID: "s1" });
    const eventB = makeV2Event("session.idle", { sessionID: "s1" });
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(defined(callback.mock.calls[0]?.[0])).toEqual({
      type: "session.status",
      properties: { sessionID: "s1" },
    });
    expect(defined(callback.mock.calls[1]?.[0])).toEqual({
      type: "session.idle",
      properties: { sessionID: "s1" },
    });
  });

  it("translates v2 execution events into legacy types", async () => {
    const eventA = makeV2Event("session.execution.succeeded", { sessionID: "s1" });
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(defined(callback.mock.calls[0]?.[0])).toEqual({
      type: "session.idle",
      properties: { sessionID: "s1" },
    });
  });

  it("bridges tool lifecycle events into message.part.updated tool parts", async () => {
    const callID = "call_123";
    const events = [
      makeV2Event("session.tool.input.started", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        name: "write",
      }),
      makeV2Event("session.tool.called", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        input: { path: "D:/repo/out.txt", content: "hello" },
        executed: false,
      }),
      makeV2Event("session.tool.success", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        content: [{ type: "text", text: "Created file" }],
        metadata: { truncated: false },
      }),
    ];
    subscribeMock.mockResolvedValueOnce({ stream: createStream(events) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    const running = defined(callback.mock.calls[0]?.[0]);
    expect(running.type).toBe("message.part.updated");
    expect((running.properties as { part: Record<string, unknown> }).part).toEqual({
      type: "tool",
      sessionID: "s1",
      messageID: "m1",
      id: callID,
      tool: "write",
      callID,
      state: {
        status: "running",
        input: { path: "D:/repo/out.txt", content: "hello", filePath: "D:/repo/out.txt" },
      },
    });

    const completed = defined(callback.mock.calls[1]?.[0]);
    expect((completed.properties as { part: Record<string, unknown> }).part.state).toMatchObject({
      status: "completed",
    });
  });

  it("reconstructs edit diff metadata from session.tool.success", async () => {
    const callID = "call_edit";
    const events = [
      makeV2Event("session.tool.input.started", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        name: "edit",
      }),
      makeV2Event("session.tool.called", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        input: { path: "D:/repo/a.ts", oldString: "x", newString: "y" },
      }),
      makeV2Event("session.tool.success", {
        sessionID: "s1",
        assistantMessageID: "m1",
        id: callID,
        content: [{ type: "text", text: "Edited a.ts" }],
        metadata: {
          files: [{ file: "a.ts", patch: "Index: a.ts\n...", status: "modified", additions: 1, deletions: 1 }],
          truncated: false,
        },
      }),
    ];
    subscribeMock.mockResolvedValueOnce({ stream: createStream(events) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    const completed = defined(callback.mock.calls[1]?.[0]);
    const part = (completed.properties as { part: Record<string, unknown> }).part;
    const state = part.state as { status: string; metadata: Record<string, unknown> };
    expect(state.status).toBe("completed");
    expect(state.metadata).toEqual({
      filediff: { file: "a.ts", additions: 1, deletions: 1 },
      diff: "Index: a.ts\n...",
    });
  });

  it("logs callback errors without failing event delivery", async () => {
    const eventA = makeV2Event("session.status", { sessionID: "s1" });
    const eventB = makeV2Event("session.idle", { sessionID: "s1" });
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });
    const callbackError = new Error("callback failed");
    const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const callback = vi
      .fn()
      .mockImplementationOnce(() => {
        throw callbackError;
      })
      .mockImplementationOnce(() => undefined);

    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith("[Events] Callback failed:", callbackError);

    stopEventListening();
    await subscription;
    loggerErrorSpy.mockRestore();
  });

  it("ignores events from other directories", async () => {
    const event = makeV2Event("session.idle", { sessionID: "s1" }, "D:/other");
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(callback).not.toHaveBeenCalled();
  });

  it("matches event directories across Windows slash and drive casing differences", async () => {
    const event = makeV2Event("session.idle", { sessionID: "s1" }, "d:/repo/");
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:\\repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(defined(callback.mock.calls[0]?.[0])).toEqual({
      type: "session.idle",
      properties: { sessionID: "s1" },
    });
  });

  it("does not create duplicate subscription for same directory while active", async () => {
    subscribeMock.mockImplementation(async () => {
      return { stream: createOpenStream() };
    });

    const firstCallback = vi.fn();
    const firstSubscription = subscribeToEvents("D:/repo", firstCallback);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await subscribeToEvents("D:/repo", vi.fn());
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    stopEventListening();
    await firstSubscription;
  });

  it("aborts previous stream when directory changes", async () => {
    subscribeMock
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      })
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      });

    const firstSubscription = subscribeToEvents("D:/repo-a", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    const secondSubscription = subscribeToEvents("D:/repo-b", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    expect(subscribeMock).toHaveBeenCalledTimes(2);

    stopEventListening();
    await Promise.all([firstSubscription, secondSubscription]);
  });

  it("throws when subscribe result has no stream", async () => {
    subscribeMock.mockResolvedValueOnce({ stream: null });

    await expect(subscribeToEvents("D:/repo", vi.fn())).rejects.toThrow(
      "No stream returned from event subscription",
    );
  });

  it("reconnects when stream ends unexpectedly", async () => {
    subscribeMock
      .mockResolvedValueOnce({ stream: createStream([]) })
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("reconnects after non-fatal stream error", async () => {
    subscribeMock
      .mockRejectedValueOnce(new Error("transient stream failure"))
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    stopEventListening();
    await subscription;
  });

  it("reconnects when an active stream stops delivering events", async () => {
    vi.useFakeTimers();
    __setSseIdleTimeoutForTests(10);

    subscribeMock
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      })
      .mockImplementationOnce(async () => {
        return { stream: createOpenStream() };
      });

    const subscription = subscribeToEvents("D:/repo", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_010);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    stopEventListening();
    await subscription;
  });

  it("resets the idle timeout after receiving an event", async () => {
    __setSseIdleTimeoutForTests(40);

    const event = makeV2Event("session.status", { sessionID: "s1" });
    subscribeMock.mockImplementation(async () => {
      return { stream: createDelayedOpenStream(event, 15) };
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    stopEventListening();
    await subscription;
  });

  it("does not deliver queued callback after listener is stopped", async () => {
    const event = makeV2Event("session.status", { sessionID: "s1" });
    let resolveEvent: (value: ReturnType<typeof makeV2Event>) => void = () => {};
    const eventPromise = new Promise<ReturnType<typeof makeV2Event>>((resolve) => {
      resolveEvent = resolve;
    });
    subscribeMock.mockResolvedValueOnce({ stream: createDeferredStream(eventPromise) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    stopEventListening();
    resolveEvent(event);
    await flushImmediate();
    await subscription;

    expect(callback).not.toHaveBeenCalled();
  });
});
