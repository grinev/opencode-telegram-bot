import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

const { subscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    event: {
      subscribe: subscribeMock,
    },
  },
}));

import {
  stopEventListening,
  subscribeToEvents,
  unsubscribeFromEvents,
} from "../../src/opencode/events.js";

function createStream(events: Event[]): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createAbortableStream(signal: AbortSignal): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

describe("opencode/events", () => {
  afterEach(() => {
    stopEventListening();
    subscribeMock.mockReset();
  });

  it("subscribes once per directory and forwards events", async () => {
    const eventA = {
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "busy" } },
    } as unknown as Event;
    const eventB = {
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as unknown as Event;
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      { directory: "/repo/a" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not start duplicate stream for same directory", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => ({
      stream: createAbortableStream(options.signal),
    }));

    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await subscribeToEvents("/repo/a", callbackA);
    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await subscribeToEvents("/repo/a", callbackB);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps existing stream when subscribing to another directory", async () => {
    let signalA: { aborted: boolean } | null = null;
    let signalB: { aborted: boolean } | null = null;

    subscribeMock
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalA = options.signal;
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalB = options.signal;
        return { stream: createAbortableStream(options.signal) };
      });

    await subscribeToEvents("/repo/a", vi.fn());
    await subscribeToEvents("/repo/b", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    expect((signalA as { aborted: boolean } | null)?.aborted ?? null).toBe(false);
    expect((signalB as { aborted: boolean } | null)?.aborted ?? null).toBe(false);
  });

  it("can unsubscribe a callback without stopping other listeners", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => ({
      stream: createAbortableStream(options.signal),
    }));

    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await subscribeToEvents("/repo/a", callbackA);
    await subscribeToEvents("/repo/a", callbackB);
    unsubscribeFromEvents("/repo/a", callbackA);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("stops only requested directory listener", async () => {
    let signalA: { aborted: boolean } | null = null;
    let signalB: { aborted: boolean } | null = null;

    subscribeMock
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalA = options.signal;
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalB = options.signal;
        return { stream: createAbortableStream(options.signal) };
      });

    await subscribeToEvents("/repo/a", vi.fn());
    await subscribeToEvents("/repo/b", vi.fn());

    stopEventListening("/repo/a");

    expect((signalA as { aborted: boolean } | null)?.aborted ?? null).toBe(true);
    expect((signalB as { aborted: boolean } | null)?.aborted ?? null).toBe(false);
  });

  it("reconnects after stream end", async () => {
    subscribeMock
      .mockResolvedValueOnce({ stream: createStream([]) })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => ({
        stream: createAbortableStream(options.signal),
      }));

    await subscribeToEvents("/repo/a", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
  });

  it("reconnects after non-fatal stream error", async () => {
    subscribeMock
      .mockRejectedValueOnce(new Error("transient error"))
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => ({
        stream: createAbortableStream(options.signal),
      }));

    await subscribeToEvents("/repo/a", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
  });
});
