import { describe, expect, it, vi } from "vitest";

type SentMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: "private"; first_name: string };
  text: string;
};

const mocked = vi.hoisted(() => ({
  loadFullSessionHistoryMock: vi.fn(),
  trackManyMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerDebugMock: vi.fn(),
}));

vi.mock("../../../src/app/services/session-history-service.js", () => ({
  loadFullSessionHistory: mocked.loadFullSessionHistoryMock,
}));

vi.mock("../../../src/app/managers/conversation-message-tracker.js", () => ({
  conversationMessageTracker: {
    trackMany: mocked.trackManyMock,
    track: vi.fn(),
    deleteAll: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { renderFullSessionHistory } from "../../../src/bot/messages/history-rendering.js";

function makeTextMessage(id: number): SentMessage {
  return {
    message_id: id,
    date: 1700000000,
    chat: { id: 1, type: "private", first_name: "Tester" },
    text: "history",
  };
}

function makeApi() {
  let nextId = 100;
  return {
    sendMessage: vi.fn(async (_chatId: number, _text: string) => makeTextMessage(nextId++)),
  };
}

describe("history-rendering", () => {
  it("sends header plus one message per entry and tracks every sent id", async () => {
    const api = makeApi();
    mocked.loadFullSessionHistoryMock.mockResolvedValue({
      entries: [
        { role: "user", text: "hello", created: 1 },
        { role: "assistant", text: "world", created: 2 },
      ],
      totalConversationMessages: 2,
    });

    await renderFullSessionHistory({
      api,
      chatId: 1,
      sessionId: "ses_1",
      directory: "/tmp",
      sessionTitle: "My session",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(3);
    const texts = api.sendMessage.mock.calls.map((call) => call[1] as string);
    expect(texts[0]).toContain("My session");
    expect(texts[0]).toContain("2 of 2");
    expect(texts[1]).toContain("You:");
    expect(texts[1]).toContain("hello");
    expect(texts[2]).toContain("Agent:");
    expect(texts[2]).toContain("world");

    const trackedIds = mocked.trackManyMock.mock.calls[0]![1] as number[];
    expect(trackedIds).toHaveLength(3);
  });

  it("appends the truncated note when older messages were omitted", async () => {
    const api = makeApi();
    mocked.loadFullSessionHistoryMock.mockResolvedValue({
      entries: [{ role: "user", text: "newest", created: 9 }],
      totalConversationMessages: 50,
    });

    await renderFullSessionHistory({
      api,
      chatId: 1,
      sessionId: "ses_1",
      directory: "/tmp",
      sessionTitle: "Big session",
    });

    const header = api.sendMessage.mock.calls[0]![1] as string;
    expect(header).toContain("1 of 50");
    expect(header).toContain("HISTORY_RENDER_LIMIT");
  });

  it("chunks long texts into multiple sends", async () => {
    const api = makeApi();
    const longText = "x".repeat(9000);
    mocked.loadFullSessionHistoryMock.mockResolvedValue({
      entries: [{ role: "user", text: longText, created: 1 }],
      totalConversationMessages: 1,
    });

    await renderFullSessionHistory({
      api,
      chatId: 1,
      sessionId: "ses_1",
      directory: "/tmp",
      sessionTitle: "Long",
    });

    // header + 3 chunks (3800 + 3800 + 1400)
    expect(api.sendMessage).toHaveBeenCalledTimes(4);
    const chunkTexts = api.sendMessage.mock.calls.slice(1).map((call) => call[1] as string);
    expect(chunkTexts[0]).toContain("You:");
    expect(chunkTexts[0]!.length).toBeLessThanOrEqual(3900);
    for (const [index, text] of chunkTexts.entries()) {
      if (index > 0) {
        expect(text.startsWith("You:")).toBe(false);
      }
    }
  });

  it("aborts silently when the header cannot be sent", async () => {
    const api = makeApi();
    api.sendMessage.mockRejectedValueOnce(new Error("chat closed"));
    mocked.loadFullSessionHistoryMock.mockResolvedValue({
      entries: [{ role: "user", text: "hello", created: 1 }],
      totalConversationMessages: 1,
    });

    await renderFullSessionHistory({
      api,
      chatId: 1,
      sessionId: "ses_1",
      directory: "/tmp",
      sessionTitle: "X",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocked.trackManyMock).not.toHaveBeenCalled();
  });

  it("keeps going when an individual message send fails", async () => {
    const api = makeApi();
    mocked.loadFullSessionHistoryMock.mockResolvedValue({
      entries: [
        { role: "user", text: "one", created: 1 },
        { role: "assistant", text: "two", created: 2 },
      ],
      totalConversationMessages: 2,
    });
    api.sendMessage
      .mockResolvedValueOnce(makeTextMessage(1)) // header ok
      .mockRejectedValueOnce(new Error("flood")) // first entry fails
      .mockResolvedValueOnce(makeTextMessage(2)); // second entry ok

    await renderFullSessionHistory({
      api,
      chatId: 1,
      sessionId: "ses_1",
      directory: "/tmp",
      sessionTitle: "Y",
    });

    expect(mocked.loggerErrorMock).toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(3);
    const trackedIds = mocked.trackManyMock.mock.calls[0]![1] as number[];
    expect(trackedIds).toEqual([1, 2]);
  });
});
