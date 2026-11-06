import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

const mocked = vi.hoisted(() => ({
  getCompactOutputMode: vi.fn(() => true),
}));

vi.mock("../../../../src/app/stores/settings-store.js", () => ({
  getCompactOutputMode: mocked.getCompactOutputMode,
  getCurrentProject: () => ({ id: "p1", worktree: "D:/repo", name: "repo" }),
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
      requestFileRefresh: () => {
        calls.push("refresh");
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

  it("asks the dashboard to refresh from the session diff and still records the card path", () => {
    aggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);
    aggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "write",
          state: {
            status: "completed",
            input: { filePath: "src/a.ts", content: "one\ntwo" },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(calls).toContain("refresh");
    expect(calls).toContain("card:src/a.ts");
    expect(calls.some((call) => call.startsWith("value:"))).toBe(false);
  });
});
