import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const processUserPromptMock = vi.hoisted(() => vi.fn());
const getCurrentSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  processUserPrompt: processUserPromptMock,
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/i18n/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/i18n/index.js")>()),
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import {
  queueBusyPrompt,
  scheduleQueueFlush,
  clearPromptQueue,
  cancelQueuedPrompt,
  unqueueLatestPrompt,
  failDispatchedQueuedPrompt,
  getQueueDepth,
  PROMPT_QUEUE_LIMIT,
  __resetPromptQueueForTests,
} from "../../../src/bot/handlers/prompt-queue.js";

const SESSION_ID = "ses_1";
const DEPS = { bot: {} as never, ensureEventSubscription: vi.fn() };

let replyMock: ReturnType<typeof vi.fn>;
let editMessageTextMock: ReturnType<typeof vi.fn>;
let sendMessageMock: ReturnType<typeof vi.fn>;
let nextAckMessageId = 100;

function makeContext(): Context {
  return {
    chat: { id: 42 },
    message: { message_id: 7 },
    reply: replyMock,
    api: { editMessageText: editMessageTextMock, sendMessage: sendMessageMock },
  } as unknown as Context;
}

function enqueue(text: string): Promise<boolean> {
  return queueBusyPrompt({
    sessionId: SESSION_ID,
    ctx: makeContext(),
    text,
    deps: DEPS,
    fileParts: [],
    options: {},
  });
}

describe("prompt-queue", () => {
  beforeEach(() => {
    __resetPromptQueueForTests();
    nextAckMessageId = 100;
    replyMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve({ message_id: nextAckMessageId++ }));
    editMessageTextMock = vi.fn().mockResolvedValue(undefined);
    sendMessageMock = vi.fn().mockResolvedValue({ message_id: 999 });
    processUserPromptMock.mockReset().mockResolvedValue(true);
    getCurrentSessionMock.mockReset().mockReturnValue({ id: SESSION_ID });
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetPromptQueueForTests();
    vi.useRealTimers();
  });

  it("acknowledges a queued prompt as a reply to the user's message", async () => {
    await enqueue("first");

    expect(getQueueDepth(SESSION_ID)).toBe(1);
    expect(replyMock).toHaveBeenCalledTimes(1);

    const [text, options] = replyMock.mock.calls[0];
    expect(text).toContain("prompt_queue.queued");
    expect(text).toContain('"position":1');
    expect(options.reply_parameters).toEqual({ message_id: 7 });
    expect(options.reply_markup).toBeDefined();
  });

  it("numbers acknowledgements by queue position", async () => {
    await enqueue("first");
    await enqueue("second");

    expect(getQueueDepth(SESSION_ID)).toBe(2);
    expect(replyMock.mock.calls[1][0]).toContain('"position":2');
  });

  it("rejects prompts once the queue is full", async () => {
    for (let index = 0; index < PROMPT_QUEUE_LIMIT; index++) {
      await enqueue(`prompt-${index}`);
    }

    const accepted = await enqueue("overflow");

    expect(accepted).toBe(false);
    expect(getQueueDepth(SESSION_ID)).toBe(PROMPT_QUEUE_LIMIT);
    expect(replyMock).toHaveBeenLastCalledWith(expect.stringContaining("prompt_queue.full"));
  });

  it("dispatches the oldest prompt first and marks its bubble as running", async () => {
    await enqueue("first");
    await enqueue("second");

    scheduleQueueFlush(SESSION_ID);
    await vi.runOnlyPendingTimersAsync();

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock.mock.calls[0][1]).toBe("first");
    expect(getQueueDepth(SESSION_ID)).toBe(1);
    expect(editMessageTextMock).toHaveBeenCalledWith(
      42,
      100,
      expect.stringContaining("prompt_queue.running"),
      expect.anything(),
    );
  });

  it("passes the queue entry back so a still-busy session can re-park it", async () => {
    await enqueue("first");

    scheduleQueueFlush(SESSION_ID);
    await vi.runOnlyPendingTimersAsync();

    const options = processUserPromptMock.mock.calls[0][4];
    expect(options.queueItem).toMatchObject({ text: "first", sessionId: SESSION_ID });
  });

  it("drops the prompt instead of replaying it into a different session", async () => {
    await enqueue("first");
    getCurrentSessionMock.mockReturnValue({ id: "ses_other" });

    scheduleQueueFlush(SESSION_ID);
    await vi.runOnlyPendingTimersAsync();

    expect(processUserPromptMock).not.toHaveBeenCalled();
    expect(getQueueDepth(SESSION_ID)).toBe(0);
    expect(sendMessageMock).toHaveBeenCalledWith(
      42,
      expect.stringContaining("prompt_queue.cleared"),
    );
  });

  it("cancels a single queued prompt by id and leaves the rest", async () => {
    await enqueue("first");
    await enqueue("second");

    const cancelled = await cancelQueuedPrompt("1");

    expect(cancelled).toBe(true);
    expect(getQueueDepth(SESSION_ID)).toBe(1);

    scheduleQueueFlush(SESSION_ID);
    await vi.runOnlyPendingTimersAsync();

    expect(processUserPromptMock.mock.calls[0][1]).toBe("second");
  });

  it("reports false when cancelling a prompt that already left the queue", async () => {
    await expect(cancelQueuedPrompt("999")).resolves.toBe(false);
  });

  it("unqueues the newest prompt and leaves the older ones", async () => {
    await enqueue("first");
    await enqueue("second");

    const removed = await unqueueLatestPrompt(SESSION_ID);

    expect(removed?.text).toBe("second");
    expect(getQueueDepth(SESSION_ID)).toBe(1);

    scheduleQueueFlush(SESSION_ID);
    await vi.runOnlyPendingTimersAsync();

    expect(processUserPromptMock.mock.calls[0][1]).toBe("first");
  });

  it("returns null when unqueueing from an empty queue", async () => {
    await expect(unqueueLatestPrompt(SESSION_ID)).resolves.toBeNull();
  });

  it("marks a failed dispatch and advances the rest of the queue", async () => {
    await enqueue("alpha");
    await enqueue("beta");

    // A real entry with a live ack bubble, standing in for the item that
    // flushQueuedPrompt shifts off the queue before dispatching it.
    const inFlight = await unqueueLatestPrompt(SESSION_ID);
    editMessageTextMock.mockClear();

    await failDispatchedQueuedPrompt(inFlight!);

    expect(editMessageTextMock).toHaveBeenCalledWith(
      42,
      inFlight!.ackMessageId,
      expect.stringContaining("prompt_queue.failed"),
      expect.anything(),
    );

    // The still-queued prompt is drained by the scheduled flush.
    await vi.runOnlyPendingTimersAsync();
    expect(processUserPromptMock).toHaveBeenCalled();
  });

  it("clears the queue and cancels its pending flush timer", async () => {
    await enqueue("first");
    scheduleQueueFlush(SESSION_ID);

    await clearPromptQueue(SESSION_ID, "test");
    await vi.runOnlyPendingTimersAsync();

    expect(getQueueDepth(SESSION_ID)).toBe(0);
    expect(processUserPromptMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      42,
      expect.stringContaining("prompt_queue.cleared"),
    );
  });

  it("keeps the prompt queued when the acknowledgement fails to send", async () => {
    replyMock.mockRejectedValueOnce(new Error("telegram down"));

    await enqueue("first");

    expect(getQueueDepth(SESSION_ID)).toBe(1);
  });
});
