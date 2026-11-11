import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadUnreadReplySessionIds,
  markSessionReplyRead,
} from "../../../src/app/services/session-reply-read-service.js";
import type { SessionReplyReadState } from "../../../src/app/types/settings.js";

const mocked = vi.hoisted(() => ({
  messages: vi.fn(),
  state: undefined as SessionReplyReadState | undefined,
  setState: vi.fn(),
  currentSession: undefined as { id: string; directory: string } | undefined,
  warn: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: { session: { messages: mocked.messages } },
}));
// The store clones on read, so the service never mutates what the file holds.
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getSessionReplyReadState: () =>
    mocked.state === undefined ? undefined : structuredClone(mocked.state),
  setSessionReplyReadState: mocked.setState,
  getCurrentSession: () => mocked.currentSession,
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocked.warn, error: vi.fn() },
}));

const reply = (completed: number | undefined, created = completed ?? 1) => ({
  info: { id: `m${created}`, role: "assistant", time: { created, completed } },
  parts: [{ type: "text", text: "the answer" }],
});

const answering = (messages: unknown[]) => mocked.messages.mockResolvedValue({ data: messages, error: null });

describe("unread reply marks", () => {
  beforeEach(() => {
    mocked.messages.mockReset();
    mocked.setState.mockReset();
    mocked.warn.mockReset();
    mocked.currentSession = undefined;
    mocked.state = { baselineAt: 100, sessions: {} };
  });

  it("marks a session whose latest reply finished after the baseline", async () => {
    answering([reply(200)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.setState).toHaveBeenCalledWith({
      baselineAt: 100,
      sessions: { s: { unreadAt: 200 } },
    });
  });

  it("treats a reply finished before the baseline as shown", async () => {
    answering([reply(50)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("compares the reply with the last shown one rather than with the baseline", async () => {
    mocked.state = { baselineAt: 100, sessions: { s: { readAt: 300 } } };
    answering([reply(200)]);

    expect([...(await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]))]).toEqual([]);

    answering([reply(400)]);

    expect([...(await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]))]).toEqual(["s"]);
  });

  it("records nothing when the latest reply was already shown", async () => {
    mocked.state = { baselineAt: 100, sessions: { s: { readAt: 400 } } };
    answering([reply(400)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("keeps the mark when a reply still streaming hides the completed one", async () => {
    mocked.state = { baselineAt: 100, sessions: { s: { unreadAt: 200 } } };
    answering([reply(undefined, 300), reply(200, 200)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("finds a completed reply that a streaming one above it must not hide", async () => {
    answering([reply(undefined, 300), reply(200, 200)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
  });

  it("reads further back for a reply buried under a full page", async () => {
    const chatter = Array.from({ length: 20 }, (_, index) => ({
      info: { id: `u${index + 2}`, role: "user", time: { created: 400 + index } },
      parts: [{ type: "text", text: "more" }],
    }));
    mocked.messages
      .mockResolvedValueOnce({ data: chatter, error: null })
      .mockResolvedValueOnce({ data: [reply(200, 200)], error: null });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.messages).toHaveBeenNthCalledWith(2, {
      sessionID: "s",
      directory: "/repo",
      limit: 20,
      before: "u2",
    });
  });

  it("asks for the whole history when the server ignores the cursor", async () => {
    const chatter = Array.from({ length: 20 }, (_, index) => ({
      info: { id: `u${index}`, role: "user", time: { created: 400 + index } },
      parts: [{ type: "text", text: "more" }],
    }));
    mocked.messages
      .mockResolvedValueOnce({ data: chatter, error: null })
      .mockResolvedValueOnce({ data: chatter, error: null })
      .mockResolvedValueOnce({ data: [reply(200, 200), ...chatter], error: null });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.messages).toHaveBeenLastCalledWith({ sessionID: "s", directory: "/repo" });
  });

  it("does not take a short page for the end of the history", async () => {
    const short = Array.from({ length: 3 }, (_, index) => ({
      info: { id: `u${index}`, role: "user", time: { created: 400 + index } },
      parts: [{ type: "text", text: "more" }],
    }));
    mocked.messages
      .mockResolvedValueOnce({ data: short, error: null })
      .mockResolvedValueOnce({ data: short, error: null })
      .mockResolvedValueOnce({ data: [reply(200, 200), ...short], error: null });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.messages).toHaveBeenLastCalledWith({ sessionID: "s", directory: "/repo" });
  });

  it("reads the whole history when the first page comes back empty", async () => {
    mocked.messages
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [reply(200, 200)], error: null });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.messages).toHaveBeenLastCalledWith({ sessionID: "s", directory: "/repo" });
  });

  it("reports no reply when the whole history is empty too", async () => {
    mocked.messages.mockResolvedValue({ data: [], error: null });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.messages).toHaveBeenLastCalledWith({ sessionID: "s", directory: "/repo" });
  });

  it("keeps the mark when even the whole history holds no reply", async () => {
    const chatter = Array.from({ length: 20 }, (_, index) => ({
      info: { id: `u${index}`, role: "user", time: { created: 400 + index } },
      parts: [{ type: "text", text: "more" }],
    }));
    answering(chatter);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.messages).toHaveBeenLastCalledWith({ sessionID: "s", directory: "/repo" });
  });

  it("keeps the mark when the read tail holds no reply at all", async () => {
    mocked.state = { baselineAt: 100, sessions: { s: { unreadAt: 200 } } };
    answering([{ info: { role: "user", time: { created: 300 } }, parts: [{ type: "text", text: "and now?" }] }]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("keeps the known mark when the check fails", async () => {
    mocked.state = { baselineAt: 100, sessions: { s: { readAt: 200, unreadAt: 300 } } };
    mocked.messages.mockResolvedValue({ data: undefined, error: new Error("UnexpectedStatus: 500") });

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual(["s"]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("does not invent a mark from a failed check", async () => {
    mocked.messages.mockRejectedValue(new Error("offline"));

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.setState).not.toHaveBeenCalled();
  });

  it("leaves the current session out", async () => {
    mocked.currentSession = { id: "s", directory: "/repo" };
    answering([reply(200)]);

    const unread = await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]);

    expect([...unread]).toEqual([]);
    expect(mocked.messages).not.toHaveBeenCalled();
  });

  it("does not mark a reply that is still streaming", async () => {
    answering([reply(undefined)]);

    expect([...(await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]))]).toEqual([]);
  });

  it("ignores tools, user input and replies without text", async () => {
    answering([
      { info: { role: "user", time: { created: 200 } }, parts: [{ type: "text", text: "hi" }] },
      { info: { role: "assistant", time: { created: 250, completed: 260 } }, parts: [{ type: "tool" }] },
    ]);

    expect([...(await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]))]).toEqual([]);
  });

  it("does nothing at all without a read state", async () => {
    mocked.state = undefined;
    answering([reply(200)]);

    expect([...(await loadUnreadReplySessionIds([{ id: "s", directory: "/repo" }]))]).toEqual([]);
    markSessionReplyRead("s", 200);
    expect(mocked.setState).not.toHaveBeenCalled();
  });
});

describe("marking a session read", () => {
  beforeEach(() => {
    mocked.setState.mockReset();
    mocked.state = { baselineAt: 100, sessions: {} };
  });

  it("records the shown reply's completion time", () => {
    markSessionReplyRead("s", 500);

    expect(mocked.setState).toHaveBeenCalledWith({
      baselineAt: 100,
      sessions: { s: { readAt: 500 } },
    });
  });

  it("keeps a mark left by a reply that finished after the shown one", () => {
    mocked.state = { baselineAt: 100, sessions: { s: { readAt: 400, unreadAt: 600 } } };

    markSessionReplyRead("s", 500);

    expect(mocked.setState).toHaveBeenCalledWith({
      baselineAt: 100,
      sessions: { s: { readAt: 500, unreadAt: 600 } },
    });
  });

  it("drops a mark the shown reply covers", () => {
    mocked.state = { baselineAt: 100, sessions: { s: { unreadAt: 400 } } };

    markSessionReplyRead("s", 500);

    expect(mocked.setState).toHaveBeenCalledWith({
      baselineAt: 100,
      sessions: { s: { readAt: 500 } },
    });
  });

  it("never moves the position backwards", () => {
    mocked.state = { baselineAt: 100, sessions: { s: { readAt: 500 } } };

    markSessionReplyRead("s", 400);

    expect(mocked.setState).not.toHaveBeenCalled();
  });
});
