import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

const { globalEventMock, subscribeMock } = vi.hoisted(() => {
  return {
    globalEventMock: vi.fn(),
    subscribeMock: vi.fn(),
  };
});

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      event: globalEventMock,
    },
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

function createStream<T>(events: T[]): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createOpenStream<T>(events: T[], signal: AbortSignal): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDeferredStream<T>(eventPromise: Promise<T>): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    yield await eventPromise;
  })();
}

function createAbortableStream(signal: AbortSignal): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createDelayedOpenStream<T>(
  event: T,
  signal: AbortSignal,
  delayMs: number,
): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield event;

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("opencode/events", () => {
  beforeEach(() => {
    globalEventMock.mockReset();
    subscribeMock.mockReset();
    globalEventMock.mockRejectedValue(new Error("global events unavailable"));
  });

  afterEach(() => {
    stopEventListening();
    __setSseIdleTimeoutForTests(30_000);
    vi.useRealTimers();
  });

  it("subscribes to stream and forwards events to callback", async () => {
    const eventA = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    const eventB = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(subscribeMock).toHaveBeenCalledWith(
      { directory: "D:/repo" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0][0]).toEqual(eventA);
    expect(callback.mock.calls[1][0]).toEqual(eventB);
  });

  it("logs callback errors without failing event delivery", async () => {
    const eventA = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    const eventB = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
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

  it("unwraps global event payloads before forwarding them", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementationOnce(function (this: { event?: unknown }) {
      expect(this.event).toBe(globalEventMock);
      return Promise.resolve({
        stream: createStream([{ directory: "D:/repo", payload: event }]),
      });
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("ignores global events from other directories", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementation(async (options: { signal: AbortSignal }) => {
      return {
        stream: createOpenStream([{ directory: "D:/other", payload: event }], options.signal),
      };
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(callback).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("matches global event directories across Windows slash and drive casing differences", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ directory: "d:/repo/", payload: event }]),
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:\\repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy project events when global stream is unavailable", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockRejectedValueOnce(new Error("global stream failed"));
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      { directory: "D:/repo" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not fall back to legacy events when OpenCode is unavailable", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        return { stream: createOpenStream([{ directory: "D:/repo", payload: event }], options.signal) };
      });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(
      () => {
        expect(callback).toHaveBeenCalledWith(event);
      },
      { timeout: 3000 },
    );
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledTimes(2);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy project events when global stream ends without project events", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    const serverConnected = { type: "server.connected", properties: {} } as Event;
    globalEventMock.mockResolvedValueOnce({ stream: createStream([{ payload: serverConnected }]) });
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });
    await flushImmediate();

    stopEventListening();
    await subscription;

    expect(globalEventMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate subscription for same directory while active", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => {
      return { stream: createAbortableStream(options.signal) };
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
    let firstSignal: { aborted: boolean } | null = null;

    subscribeMock
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        firstSignal = options.signal;
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
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
    expect(firstSignal).toEqual(expect.objectContaining({ aborted: true }));

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
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
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
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
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
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        return { stream: createAbortableStream(options.signal) };
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

    const event = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => {
      return { stream: createDelayedOpenStream(event, options.signal, 15) };
    });

    const callback = vi.fn();
    const subscription = subscribeToEvents("D:/repo", callback);

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    }, { timeout: 500 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    stopEventListening();
    await subscription;
  });

  it("does not deliver queued callback after listener is stopped", async () => {
    const event = { type: "session.status", properties: { sessionID: "s1" } } as Event;
    let resolveEvent: (event: Event) => void = () => {};
    const eventPromise = new Promise<Event>((resolve) => {
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
