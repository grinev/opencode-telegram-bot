import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  deleteMessageMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
  },
}));

import { conversationMessageTracker } from "../../../src/app/managers/conversation-message-tracker.js";

const api = { deleteMessage: mocked.deleteMessageMock };
const CHAT_ID = 12345;

describe("conversation-message-tracker", () => {
  beforeEach(() => {
    conversationMessageTracker.__resetForTests();
    mocked.deleteMessageMock.mockReset();
    mocked.deleteMessageMock.mockResolvedValue(undefined);
  });

  it("returns zero counts when nothing was tracked", async () => {
    const result = await conversationMessageTracker.deleteAll(api, CHAT_ID, "test");
    expect(result).toEqual({ deleted: 0, failed: 0 });
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("tracks and deletes each message once (dedup)", async () => {
    conversationMessageTracker.track(CHAT_ID, 1);
    conversationMessageTracker.track(CHAT_ID, 1);
    conversationMessageTracker.trackMany(CHAT_ID, [2, 3]);

    const result = await conversationMessageTracker.deleteAll(api, CHAT_ID, "test");

    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(0);
    expect(api.deleteMessage).toHaveBeenCalledTimes(3);
    const calledIds = api.deleteMessage.mock.calls.map((call) => call[1]);
    expect(calledIds.sort()).toEqual([1, 2, 3]);
  });

  it("isolates chats", async () => {
    conversationMessageTracker.track(CHAT_ID, 1);
    conversationMessageTracker.track(999, 2);

    const result = await conversationMessageTracker.deleteAll(api, CHAT_ID, "test");

    expect(result.deleted).toBe(1);
    expect(api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, 1);
  });

  it("tolerates undeletable messages and counts them as failed", async () => {
    conversationMessageTracker.trackMany(CHAT_ID, [1, 2, 3]);
    mocked.deleteMessageMock.mockImplementation((_chatId: number, messageId: number) => {
      if (messageId === 2) {
        return Promise.reject(new Error("Bad Request: message can't be deleted for everyone"));
      }
      if (messageId === 3) {
        return Promise.reject(new Error("Bad Request: message to delete not found"));
      }
      return Promise.resolve({ message_id: messageId });
    });

    const result = await conversationMessageTracker.deleteAll(api, CHAT_ID, "test");

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(2);
  });

  it("continues after unexpected errors but still counts them as failed", async () => {
    conversationMessageTracker.trackMany(CHAT_ID, [1, 2]);
    mocked.deleteMessageMock.mockImplementation((_chatId: number, messageId: number) => {
      if (messageId === 1) {
        return Promise.reject(new Error("Network exploded"));
      }
      return Promise.resolve({ message_id: messageId });
    });

    const result = await conversationMessageTracker.deleteAll(api, CHAT_ID, "test");

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("captures messages sent during deletion on the next cleanup", async () => {
    conversationMessageTracker.track(CHAT_ID, 1);
    // Simulate a message arriving while deleteAll is in flight.
    mocked.deleteMessageMock.mockImplementation(async () => {
      conversationMessageTracker.track(CHAT_ID, 99);
      return { message_id: 0 };
    });

    await conversationMessageTracker.deleteAll(api, CHAT_ID, "first");
    const second = await conversationMessageTracker.deleteAll(api, CHAT_ID, "second");

    expect(second.deleted).toBe(1);
    expect(api.deleteMessage).toHaveBeenLastCalledWith(CHAT_ID, 99);
  });

  it("ignores invalid ids when tracking", () => {
    conversationMessageTracker.track(Number.NaN, 1);
    conversationMessageTracker.track(CHAT_ID, Number.NaN);

    return conversationMessageTracker.deleteAll(api, CHAT_ID, "test").then((result) => {
      expect(result.deleted).toBe(0);
    });
  });
});
