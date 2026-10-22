import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { SummaryAggregator } from "../../../src/app/managers/summary-aggregation-manager.js";

function emitPartial(aggregator: SummaryAggregator, messageId: string, text: string): void {
  aggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        sessionID: "session-1",
        role: "assistant",
        time: { created: 1 },
      },
    },
  } as unknown as Event);
  aggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `${messageId}-part`,
        sessionID: "session-1",
        messageID: messageId,
        type: "text",
        text,
        time: { start: 1 },
      },
    },
  } as unknown as Event);
}

function emitDelta(
  aggregator: SummaryAggregator,
  messageId: string,
  partId: string,
  delta: string,
  type: "text" | "reasoning" = "text",
): void {
  aggregator.processEvent({
    type: "message.part.delta",
    properties: {
      part: { id: partId, sessionID: "session-1", messageID: messageId, type },
      delta,
    },
  } as unknown as Event);
}

describe("summary aggregator outbound hold", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers a callback immediately when the hold is off", () => {
    const aggregator = new SummaryAggregator();
    const onPartial = vi.fn();
    aggregator.setSession("session-1");
    aggregator.setOnPartial(onPartial);

    emitPartial(aggregator, "message-1", "now");

    expect(onPartial).toHaveBeenCalledOnce();
  });

  it("drains deferred callbacks one at a time with a gap", async () => {
    vi.useFakeTimers();
    const aggregator = new SummaryAggregator();
    const texts: string[] = [];
    aggregator.setSession("session-1");
    aggregator.setOnPartial((_sessionId, _messageId, text) => {
      texts.push(text);
    });
    const generation = aggregator.holdOutbound();

    emitPartial(aggregator, "message-1", "first");
    emitPartial(aggregator, "message-2", "second");
    expect(texts).toEqual([]);

    const draining = aggregator.drainOutbound(1000, generation);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(999);
    expect(texts).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(texts).toEqual(["first", "second"]);
    await draining;
    expect(aggregator.hasDeferredOutbound()).toBe(false);
  });

  it("delivers the dashboard's values during a hold while chat output stays held", async () => {
    const aggregator = new SummaryAggregator();
    const onPartial = vi.fn();
    const onTokens = vi.fn();
    const onSessionDiff = vi.fn();
    aggregator.setSession("session-1");
    aggregator.setOnPartial(onPartial);
    aggregator.setOnTokens(onTokens);
    aggregator.setOnSessionDiff(onSessionDiff);
    aggregator.holdOutbound();

    aggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1 },
          tokens: { input: 100, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
    } as unknown as Event);
    emitPartial(aggregator, "message-1", "held");
    aggregator.processEvent({
      type: "session.diff",
      properties: {
        sessionID: "session-1",
        diff: [{ file: "src/a.ts", additions: 1, deletions: 0 }],
      },
    } as unknown as Event);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onTokens).toHaveBeenCalled();
    expect(onSessionDiff).toHaveBeenCalledOnce();
    expect(onPartial).not.toHaveBeenCalled();
  });

  it("runs a queued task now when not held and after the drain when held", async () => {
    const aggregator = new SummaryAggregator();
    const task = vi.fn();

    await aggregator.runOutbound(task);
    expect(task).toHaveBeenCalledOnce();

    const generation = aggregator.holdOutbound();
    await aggregator.runOutbound(task);
    expect(task).toHaveBeenCalledOnce();

    await aggregator.drainOutbound(0, generation);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("coalesces deferred partial text into the latest payload", async () => {
    const aggregator = new SummaryAggregator();
    const onPartial = vi.fn();
    aggregator.setSession("session-1");
    aggregator.setOnPartial(onPartial);
    const generation = aggregator.holdOutbound();

    emitPartial(aggregator, "message-1", "Hel");
    emitDelta(aggregator, "message-1", "message-1-part", "lo");
    emitDelta(aggregator, "message-1", "message-1-part", " world");

    await aggregator.drainOutbound(0, generation);

    expect(onPartial).toHaveBeenCalledOnce();
    expect(onPartial).toHaveBeenCalledWith("session-1", "message-1", "Hello world");
  });

  it("keeps the order of a coalesced partial and a plain deferred task", async () => {
    const aggregator = new SummaryAggregator();
    const order: string[] = [];
    aggregator.setSession("session-1");
    aggregator.setOnPartial(() => {
      order.push("partial");
    });
    const generation = aggregator.holdOutbound();

    emitPartial(aggregator, "message-1", "A");
    emitDelta(aggregator, "message-1", "message-1-part", "B");
    await aggregator.runOutbound(() => {
      order.push("plain");
    });

    await aggregator.drainOutbound(0, generation);

    expect(order).toEqual(["partial", "plain"]);
  });

  it("awaits the running drain instead of starting a second one", async () => {
    const aggregator = new SummaryAggregator();
    const calls: number[] = [];
    let releaseFirst!: () => void;
    let secondSettled = false;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const generation = aggregator.holdOutbound();
    aggregator.runOutbound(() => gate);
    aggregator.runOutbound(() => {
      calls.push(2);
    });

    const firstDrain = aggregator.drainOutbound(0, generation);
    await Promise.resolve();
    const secondDrain = aggregator.drainOutbound(0, generation);
    void secondDrain.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(secondSettled).toBe(false);

    releaseFirst();
    await firstDrain;
    await secondDrain;
    expect(calls).toEqual([2]);
    expect(secondSettled).toBe(true);
  });

  it("does not let a stale generation drain a newer hold", async () => {
    const aggregator = new SummaryAggregator();
    const calls: string[] = [];

    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("a");
    });
    const generationB = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("b");
    });

    await aggregator.drainOutbound(0, generationA);
    expect(calls).toEqual([]);

    await aggregator.drainOutbound(0, generationB);
    expect(calls).toEqual(["a", "b"]);
  });

  it("stops a running drain when a newer hold starts", async () => {
    const aggregator = new SummaryAggregator();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => gate);
    aggregator.runOutbound(() => {
      calls.push("a");
    });

    const drainA = aggregator.drainOutbound(0, generationA);
    await Promise.resolve();

    const generationB = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("b");
    });

    releaseFirst();
    await drainA;
    expect(calls).toEqual([]);

    await aggregator.drainOutbound(0, generationB);
    expect(calls).toEqual(["a", "b"]);
  });

  it("resolves the idle barrier after a newer hold drains the queue", async () => {
    const aggregator = new SummaryAggregator();
    let releaseFirst!: () => void;
    let idleResolved = false;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => gate);
    const drainA = aggregator.drainOutbound(0, generationA);
    await Promise.resolve();

    const generationB = aggregator.holdOutbound();
    aggregator.runOutbound(() => {});
    const idle = aggregator.whenOutboundIdle();
    void idle.then(() => {
      idleResolved = true;
    });

    releaseFirst();
    await drainA;
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    await aggregator.drainOutbound(0, generationB);
    await idle;
    expect(idleResolved).toBe(true);
  });

  it("delivers a newer payload that arrives while the keyed entry is already draining", async () => {
    vi.useFakeTimers();
    const aggregator = new SummaryAggregator();
    const texts: string[] = [];
    aggregator.setSession("session-1");
    aggregator.setOnPartial((_sessionId, _messageId, text) => {
      texts.push(text);
    });
    const generation = aggregator.holdOutbound();

    emitPartial(aggregator, "message-1", "first");
    emitPartial(aggregator, "message-1", "second");
    await aggregator.runOutbound(() => {});

    const draining = aggregator.drainOutbound(1000, generation);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(["second"]);

    emitDelta(aggregator, "message-1", "message-1-part", " third");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await draining;

    expect(texts).toEqual(["second", "second third"]);
  });

  it("coalesces deferred thinking updates while keeping the first update", async () => {
    const aggregator = new SummaryAggregator();
    const onThinking = vi.fn();
    aggregator.setSession("session-1");
    aggregator.setOnThinking(onThinking);
    const generation = aggregator.holdOutbound();

    aggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1 },
        },
      },
    } as unknown as Event);
    aggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "reasoning",
          title: "Analysis",
          text: "first ",
        },
      },
    } as unknown as Event);
    emitDelta(aggregator, "message-1", "reasoning-1", "second", "reasoning");
    emitDelta(aggregator, "message-1", "reasoning-1", " third", "reasoning");

    await aggregator.drainOutbound(0, generation);

    expect(onThinking).toHaveBeenCalledTimes(2);
    expect(onThinking.mock.calls[0]?.[0]).toMatchObject({
      isFirstUpdate: true,
      sections: [{ id: "reasoning-1", title: "Analysis", text: "first " }],
    });
    expect(onThinking.mock.calls[1]?.[0]).toMatchObject({
      isFirstUpdate: false,
      sections: [{ id: "reasoning-1", title: "Analysis", text: "first second third" }],
    });
  });

  it("runs the latest payload when a delta replaces the head during the gap", async () => {
    vi.useFakeTimers();
    const aggregator = new SummaryAggregator();
    const texts: string[] = [];
    aggregator.setSession("session-1");
    aggregator.setOnPartial((_sessionId, _messageId, text) => {
      texts.push(text);
    });
    const generation = aggregator.holdOutbound();

    await aggregator.runOutbound(() => {});
    emitPartial(aggregator, "message-1", "first");

    const draining = aggregator.drainOutbound(1000, generation);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual([]);

    emitDelta(aggregator, "message-1", "message-1-part", " second");
    await vi.advanceTimersByTimeAsync(1000);
    await draining;

    expect(texts).toEqual(["first second"]);
    expect(aggregator.hasDeferredOutbound()).toBe(false);
  });

  it("leaves the queue to a newer hold that starts during the gap", async () => {
    vi.useFakeTimers();
    const aggregator = new SummaryAggregator();
    const calls: string[] = [];
    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("first");
    });
    aggregator.runOutbound(() => {
      calls.push("second");
    });

    const drainA = aggregator.drainOutbound(1000, generationA);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["first"]);

    const generationB = aggregator.holdOutbound();
    await vi.advanceTimersByTimeAsync(1000);
    await drainA;
    expect(calls).toEqual(["first"]);

    await aggregator.drainOutbound(0, generationB);
    expect(calls).toEqual(["first", "second"]);
  });

  it("returns a caller whose generation went stale while it awaited the drain", async () => {
    const aggregator = new SummaryAggregator();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => gate);
    const drainA = aggregator.drainOutbound(0, generationA);
    await Promise.resolve();

    // Still the current generation: this caller enters the await-the-drain branch.
    const secondCallA = aggregator.drainOutbound(0, generationA);
    let secondSettled = false;
    void secondCallA.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    const generationB = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("b");
    });

    releaseFirst();
    await drainA;
    await secondCallA;
    expect(calls).toEqual([]);

    await aggregator.drainOutbound(0, generationB);
    expect(calls).toEqual(["b"]);
  });

  it("returns a stale caller without draining a newer hold", async () => {
    const aggregator = new SummaryAggregator();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const generationA = aggregator.holdOutbound();
    aggregator.runOutbound(() => gate);
    const drainA = aggregator.drainOutbound(0, generationA);
    await Promise.resolve();

    const generationB = aggregator.holdOutbound();
    aggregator.runOutbound(() => {
      calls.push("b");
    });
    const staleCall = aggregator.drainOutbound(0, generationA);
    const drainB = aggregator.drainOutbound(0, generationB);

    releaseFirst();
    await drainA;
    await staleCall;
    await drainB;

    expect(calls).toEqual(["b"]);
  });
});
