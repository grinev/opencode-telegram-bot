import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const processUserPromptMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  processUserPrompt: processUserPromptMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerErrorMock },
}));

import {
  queuePromptForMerging,
  flushPendingPrompt,
  __resetMessageMergerForTests,
} from "../../../src/bot/handlers/message-merger.js";

const DEPS = { bot: {} as never, ensureEventSubscription: vi.fn() };
const LARGE_TEXT = "x".repeat(4000);

function makeContext(chatId: number): Context {
  return { chat: { id: chatId } } as unknown as Context;
}

describe("message-merger", () => {
  beforeEach(() => {
    __resetMessageMergerForTests();
    processUserPromptMock.mockReset().mockResolvedValue(true);
    loggerErrorMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetMessageMergerForTests();
    vi.useRealTimers();
  });

  it("processes immediately when merge window is disabled (<=0)", () => {
    const ctx = makeContext(1);

    queuePromptForMerging(ctx, "hello", DEPS, 0);

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctx, "hello", DEPS);
  });

  it("processes short messages immediately when merging is enabled", () => {
    const ctx = makeContext(1);

    queuePromptForMerging(ctx, "hello", DEPS, 1500);

    expect(processUserPromptMock).toHaveBeenCalledWith(ctx, "hello", DEPS);
  });

  it("flushes a single buffered message after the window elapses", () => {
    const ctx = makeContext(1);

    queuePromptForMerging(ctx, LARGE_TEXT, DEPS, 1500);

    expect(processUserPromptMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctx, LARGE_TEXT, DEPS);
  });

  it("merges quick consecutive messages into one prompt", () => {
    const ctx = makeContext(1);

    queuePromptForMerging(ctx, LARGE_TEXT, DEPS, 1500);
    vi.advanceTimersByTime(1000);
    queuePromptForMerging(ctx, "part 2", DEPS, 1500);

    // Window restarted by the second chunk, no flush yet.
    expect(processUserPromptMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1499);
    expect(processUserPromptMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctx, `${LARGE_TEXT}\n\npart 2`, DEPS);
  });

  it("flushes separately when messages are farther apart than the window", () => {
    const ctx = makeContext(1);

    const first = "a".repeat(4000);
    const second = "b".repeat(4000);

    queuePromptForMerging(ctx, first, DEPS, 1500);
    vi.advanceTimersByTime(1500);
    expect(processUserPromptMock).toHaveBeenCalledTimes(1);

    queuePromptForMerging(ctx, second, DEPS, 1500);
    vi.advanceTimersByTime(1500);

    expect(processUserPromptMock).toHaveBeenCalledTimes(2);
    expect(processUserPromptMock).toHaveBeenNthCalledWith(1, ctx, first, DEPS);
    expect(processUserPromptMock).toHaveBeenNthCalledWith(2, ctx, second, DEPS);
  });

  it("buffers per chat independently", () => {
    const ctxA = makeContext(1);
    const ctxB = makeContext(2);

    const textA = "a".repeat(4000);
    const textB = "b".repeat(4000);
    queuePromptForMerging(ctxA, textA, DEPS, 1500);
    queuePromptForMerging(ctxB, textB, DEPS, 1500);

    vi.advanceTimersByTime(1500);

    expect(processUserPromptMock).toHaveBeenCalledTimes(2);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctxA, textA, DEPS);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctxB, textB, DEPS);
  });

  it("flushPendingPrompt flushes immediately and clears the buffer", () => {
    const ctx = makeContext(1);

    queuePromptForMerging(ctx, LARGE_TEXT, DEPS, 1500);
    flushPendingPrompt(1);

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctx, LARGE_TEXT, DEPS);

    // A late timer fire must not double-flush.
    vi.advanceTimersByTime(1500);
    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
  });

  it("uses the latest ctx when merging", () => {
    const ctx1 = makeContext(1);
    const ctx2 = makeContext(1);

    queuePromptForMerging(ctx1, LARGE_TEXT, DEPS, 1500);
    queuePromptForMerging(ctx2, "second", DEPS, 1500);
    vi.advanceTimersByTime(1500);

    expect(processUserPromptMock).toHaveBeenCalledTimes(1);
    expect(processUserPromptMock).toHaveBeenCalledWith(ctx2, `${LARGE_TEXT}\n\nsecond`, DEPS);
  });

  it("logs rejected immediate prompt processing", async () => {
    const error = new Error("prompt failed");
    processUserPromptMock.mockRejectedValueOnce(error);

    queuePromptForMerging(makeContext(1), "hello", DEPS, 1500);
    await Promise.resolve();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[Bot] Failed to process prompt (chatId=1)",
      error,
    );
  });

  it("logs rejected merged prompt processing", async () => {
    const error = new Error("merged prompt failed");
    processUserPromptMock.mockRejectedValueOnce(error);

    queuePromptForMerging(makeContext(1), LARGE_TEXT, DEPS, 1500);
    await vi.advanceTimersByTimeAsync(1500);

    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[Bot] Failed to process merged prompt (chatId=1)",
      error,
    );
  });
});
