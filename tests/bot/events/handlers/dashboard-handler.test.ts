import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

const mocked = vi.hoisted(() => ({
  getCompactOutputMode: vi.fn(() => true),
}));

vi.mock("../../../../src/app/stores/settings-store.js", () => ({
  getCompactOutputMode: mocked.getCompactOutputMode,
}));

const { SummaryAggregator } = await import(
  "../../../../src/app/managers/summary-aggregation-manager.js"
);
const { registerDashboardHandlers } = await import(
  "../../../../src/bot/events/handlers/dashboard-handler.js"
);

function emitSessionDiff(aggregator: InstanceType<typeof SummaryAggregator>, file: string): void {
  aggregator.processEvent({
    type: "session.diff",
    properties: {
      sessionID: "session-1",
      diff: [{ file, additions: 1, deletions: 0 }],
    },
  } as unknown as Event);
}

describe("bot/events/dashboard-handler", () => {
  let aggregator: InstanceType<typeof SummaryAggregator>;
  let calls: string[];

  beforeEach(() => {
    aggregator = new SummaryAggregator();
    aggregator.setSession("session-1");
    calls = [];
    let schedule: ((task: () => Promise<void>) => Promise<void>) | null = null;

    const pinnedMessageManager = {
      isInitialized: () => true,
      setRenderScheduler: (scheduler: (task: () => Promise<void>) => Promise<void>) => {
        schedule = scheduler;
      },
      onSessionDiff: async (diffs: Array<{ file: string }>) => {
        calls.push(`value:${diffs.map((diff) => diff.file).join(",")}`);
        await schedule?.(async () => {
          calls.push("redraw");
        });
      },
      setOnKeyboardUpdate: vi.fn(),
    };

    registerDashboardHandlers({
      runtime: {
        compactProgressStreamer: {
          addFileChange: (_sessionId: string, file: string) => calls.push(`card:${file}`),
        },
      },
      policy: {},
      keyboardManager: { updateContext: vi.fn() },
      pinnedMessageManager,
      summaryAggregator: aggregator,
    } as never);
  });

  it("applies values at once during a hold and queues the redraw and the card's files in order", async () => {
    const generation = aggregator.holdOutbound();

    emitSessionDiff(aggregator, "src/a.ts");
    emitSessionDiff(aggregator, "src/b.ts");
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toEqual(["value:src/a.ts", "value:src/b.ts"]);

    await aggregator.drainOutbound(0, generation);

    expect(calls).toEqual([
      "value:src/a.ts",
      "value:src/b.ts",
      "card:src/a.ts",
      "redraw",
      "card:src/b.ts",
      "redraw",
    ]);
  });

  it("feeds the card and redraws at once when nothing is held", async () => {
    emitSessionDiff(aggregator, "src/a.ts");
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toEqual(["card:src/a.ts", "value:src/a.ts", "redraw"]);
  });
});
