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
    aggregator.holdOutbound();

    emitPartial(aggregator, "message-1", "first");
    emitPartial(aggregator, "message-2", "second");
    expect(texts).toEqual([]);

    const draining = aggregator.drainOutbound(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(999);
    expect(texts).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(texts).toEqual(["first", "second"]);
    await draining;
    expect(aggregator.hasDeferredOutbound()).toBe(false);
  });
});
