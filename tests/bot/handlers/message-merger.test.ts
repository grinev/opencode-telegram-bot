import { beforeEach, afterEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";

const processUserPromptMock = vi.hoisted(() => vi.fn());
const processUserPromptInputMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock("#src/bot/handlers/prompt.ts", () => ({
  processUserPrompt: (
    ctx: Context,
    input: { text: string; fileParts: unknown[]; photos: unknown[] },
    deps: unknown,
  ) => {
    processUserPromptInputMock(ctx, input, deps);
    return processUserPromptMock(ctx, input.text, deps);
  },
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerErrorMock },
}));

const {
  queuePromptForMerging: queueIncomingPromptForMerging,
  flushPendingPrompt,
  __resetMessageMergerForTests,
} = await loadSut<typeof import("#src/bot/handlers/message-merger.js")>(
  "#src/bot/handlers/message-merger.ts",
  import.meta.url,
);

const DEPS = { bot: {} as never, ensureEventSubscription: vi.fn() };
const LARGE_TEXT = "x".repeat(4000);

function makeContext(chatId: number): Context {
  return { chat: { id: chatId } } as unknown as Context;
}

function queuePromptForMerging(
  ctx: Context,
  text: string,
  deps: typeof DEPS,
  mergeWindowMs: number,
): void {
  queueIncomingPromptForMerging(ctx, createIncomingPrompt(text), deps, mergeWindowMs);
}

describe("message-merger", () => {
  beforeEach(() => {
    __resetMessageMergerForTests();
    processUserPromptMock.mockReset().mockResolvedValue(true);
    processUserPromptInputMock.mockReset();
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

  it("keeps deferred rich photos in message order while merging", () => {
    const ctx = makeContext(1);
    const firstPhoto = { fileId: "photo-1", filename: "first.jpg", source: "rich" as const };
    const secondPhoto = { fileId: "photo-2", filename: "second.jpg", source: "rich" as const };

    queueIncomingPromptForMerging(
      ctx,
      createIncomingPrompt(LARGE_TEXT, { photos: [firstPhoto] }),
      DEPS,
      1500,
    );
    queueIncomingPromptForMerging(
      ctx,
      createIncomingPrompt("part 2", { photos: [secondPhoto] }),
      DEPS,
      1500,
    );
    vi.advanceTimersByTime(1500);

    expect(processUserPromptInputMock).toHaveBeenCalledWith(
      ctx,
      {
        text: `${LARGE_TEXT}\n\npart 2`,
        fileParts: [],
        photos: [firstPhoto, secondPhoto],
      },
      DEPS,
    );
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
