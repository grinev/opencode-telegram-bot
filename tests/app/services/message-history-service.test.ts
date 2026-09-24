import { beforeEach, describe, expect, it, vi } from "vitest";

const messages = vi.hoisted(() => vi.fn());
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: { session: { messages } },
}));

import { loadLatestAssistantMetrics } from "../../../src/app/services/message-history-service.js";

const assistant = (created: number, input: number, summary = false) => ({
  info: {
    role: "assistant",
    summary,
    time: { created },
    tokens: { input, output: 12, reasoning: 3, cache: { read: 8, write: 4 } },
    cost: 0.123,
  },
  parts: [{ type: "text", text: "Private answer text" }],
});

describe("loadLatestAssistantMetrics", () => {
  beforeEach(() => messages.mockReset());

  it("selects the latest non-summary assistant and returns only its metrics", async () => {
    messages.mockResolvedValue({
      data: [assistant(20, 200, true), assistant(10, 100), assistant(5, 50)],
    });

    expect(await loadLatestAssistantMetrics("session", "directory")).toEqual({
      input: 100, output: 12, reasoning: 3, cacheRead: 8, cacheWrite: 4, cost: 0.123,
    });
    expect(messages).toHaveBeenCalledWith({ sessionID: "session", directory: "directory" });
  });

  it("returns no breakdown when there is no assistant message", async () => {
    messages.mockResolvedValue({ data: [{ info: { role: "user" }, parts: [] }] });
    expect(await loadLatestAssistantMetrics("session", "directory")).toBeNull();
  });

  it("does not mistake a failed fetch for empty history", async () => {
    messages.mockResolvedValue({ error: new Error("offline") });
    await expect(loadLatestAssistantMetrics("session", "directory")).rejects.toThrow("offline");
  });
});
