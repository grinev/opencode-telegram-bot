import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

import {
  MediaGroupAttachmentHandler,
  type MediaGroupHandlerDeps,
} from "../../../src/bot/handlers/media-group-handler.js";
import { t } from "../../../src/i18n/index.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { MAX_QUEUED_MEDIA_BYTES } from "../../../src/app/managers/prompt-queue-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";

function createBaseContext(message: Record<string, unknown>): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 100 });

  const ctx = {
    chat: { id: 777 },
    message: {
      media_group_id: "album-1",
      caption: "",
      ...message,
    },
    reply: replyMock,
    api: {},
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDocumentContext(options: {
  messageId: number;
  fileId: string;
  filename: string;
  mimeType: string;
  caption?: string;
  fileSize?: number;
}): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  return createBaseContext({
    message_id: options.messageId,
    caption: options.caption || "",
    document: {
      file_id: options.fileId,
      file_unique_id: `${options.fileId}-unique`,
      file_name: options.filename,
      mime_type: options.mimeType,
      file_size: options.fileSize ?? 1024,
    },
  });
}

function createPhotoContext(options: {
  messageId: number;
  smallFileId: string;
  largeFileId: string;
  fileSize?: number;
  caption?: string;
}): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  return createBaseContext({
    message_id: options.messageId,
    caption: options.caption || "",
    photo: [
      {
        file_id: options.smallFileId,
        file_unique_id: `${options.smallFileId}-unique`,
        width: 320,
        height: 240,
      },
      {
        file_id: options.largeFileId,
        file_unique_id: `${options.largeFileId}-unique`,
        width: 1280,
        height: 960,
        file_size: options.fileSize ?? 1024,
      },
    ],
  });
}

function createUnsupportedMediaContext(messageId: number): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  return createBaseContext({
    message_id: messageId,
    video: {
      file_id: "video-file-id",
      file_unique_id: "video-unique",
      width: 1280,
      height: 720,
      duration: 5,
    },
  });
}

function createDeps(overrides: Partial<MediaGroupHandlerDeps> = {}): {
  deps: MediaGroupHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  getCapabilitiesMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn(async (_api: Context["api"], fileId: string) => ({
    buffer: Buffer.from(`content:${fileId}`),
    filePath: `documents/${fileId}`,
  }));
  const getCapabilitiesMock = vi.fn().mockResolvedValue({
    input: { image: true, pdf: true },
  });

  const deps: MediaGroupHandlerDeps = {
    bot: {} as MediaGroupHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: vi.fn(() => ({ providerID: "test-provider", modelID: "test-model" })),
    processPrompt: (ctx, input, promptDeps) =>
      processPromptMock(ctx, input.text, promptDeps, input.fileParts),
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, getCapabilitiesMock };
}

async function addToHandler(handler: MediaGroupAttachmentHandler, ctx: Context): Promise<void> {
  const next = vi.fn() as unknown as NextFunction;
  await handler.handle(ctx, next);
  expect(next).not.toHaveBeenCalled();
}

describe("bot/handlers/media-group", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
    promptQueue.__resetForTests();
    foregroundSessionState.__resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends multiple image documents as one prompt", async () => {
    const first = createDocumentContext({
      messageId: 10,
      fileId: "image-1",
      filename: "first.png",
      mimeType: "image/png",
    });
    const second = createDocumentContext({
      messageId: 11,
      fileId: "image-2",
      filename: "second.png",
      mimeType: "image/png",
      caption: "What is on these images?",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    await handler.flushAll();

    expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(first.replyMock).toHaveBeenCalledWith(t("bot.files_downloading"));
    expect(processPromptMock).toHaveBeenCalledTimes(1);
    expect(processPromptMock).toHaveBeenCalledWith(
      first.ctx,
      "What is on these images?",
      deps,
      [
        expect.objectContaining({
          type: "file",
          mime: "image/png",
          filename: "first.png",
          url: expect.stringMatching(/^data:image\/png;base64,/),
        }),
        expect.objectContaining({
          type: "file",
          mime: "image/png",
          filename: "second.png",
          url: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ],
    );
  });

  it("queues an album as one item while the agent is busy", async () => {
    vi.spyOn(settingsStore, "getPromptQueueEnabled").mockReturnValue(true);
    vi.spyOn(settingsStore, "getCurrentSession").mockReturnValue({
      id: "session-1",
      title: "Session",
      directory: "/repo",
    });
    foregroundSessionState.markBusy("session-1", "/repo");
    const first = createPhotoContext({
      messageId: 20,
      smallFileId: "small-1",
      largeFileId: "large-1",
      caption: "Compare these photos",
    });
    const second = createPhotoContext({
      messageId: 21,
      smallFileId: "small-2",
      largeFileId: "large-2",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    await handler.flushAll();

    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.size()).toBe(1);
    expect(promptQueue.list()[0]).toEqual(
      expect.objectContaining({
        displayText: "Compare these photos",
        fileParts: [
          expect.objectContaining({ filename: "photo-20.jpg" }),
          expect.objectContaining({ filename: "photo-21.jpg" }),
        ],
      }),
    );
  });

  it("rejects an oversized busy album before downloading any item", async () => {
    vi.spyOn(settingsStore, "getPromptQueueEnabled").mockReturnValue(true);
    foregroundSessionState.markBusy("session-1", "/repo");
    const first = createPhotoContext({
      messageId: 20,
      smallFileId: "small-1",
      largeFileId: "large-1",
      fileSize: MAX_QUEUED_MEDIA_BYTES,
    });
    const second = createPhotoContext({
      messageId: 21,
      smallFileId: "small-2",
      largeFileId: "large-2",
      fileSize: 1,
    });
    const { deps, downloadMock, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    await handler.flushAll();

    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("uses the largest photo from each media group item", async () => {
    const first = createPhotoContext({
      messageId: 20,
      smallFileId: "small-1",
      largeFileId: "large-1",
      caption: "Compare these photos",
    });
    const second = createPhotoContext({
      messageId: 21,
      smallFileId: "small-2",
      largeFileId: "large-2",
    });
    const { deps, processPromptMock, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    await handler.flushAll();

    expect(downloadMock).toHaveBeenCalledWith(first.ctx.api, "large-1");
    expect(downloadMock).toHaveBeenCalledWith(second.ctx.api, "large-2");
    expect(processPromptMock).toHaveBeenCalledWith(
      first.ctx,
      "Compare these photos",
      deps,
      [
        expect.objectContaining({ mime: "image/jpeg", filename: "photo-20.jpg" }),
        expect.objectContaining({ mime: "image/jpeg", filename: "photo-21.jpg" }),
      ],
    );
  });

  it("combines image, PDF, and text documents into one prompt", async () => {
    const image = createDocumentContext({
      messageId: 30,
      fileId: "image-file",
      filename: "screen.png",
      mimeType: "image/png",
    });
    const pdf = createDocumentContext({
      messageId: 31,
      fileId: "pdf-file",
      filename: "spec.pdf",
      mimeType: "application/pdf",
    });
    const text = createDocumentContext({
      messageId: 32,
      fileId: "text-file",
      filename: "notes.txt",
      mimeType: "text/plain",
      caption: "Summarize everything",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, image.ctx);
    await addToHandler(handler, pdf.ctx);
    await addToHandler(handler, text.ctx);
    await handler.flushAll();

    expect(processPromptMock).toHaveBeenCalledWith(
      image.ctx,
      "--- Content of notes.txt ---\ncontent:text-file\n--- End of file ---\n\nSummarize everything",
      deps,
      [
        expect.objectContaining({ mime: "image/png", filename: "screen.png" }),
        expect.objectContaining({ mime: "application/pdf", filename: "spec.pdf" }),
      ],
    );
  });

  it("keeps captions in message order", async () => {
    const laterMessage = createDocumentContext({
      messageId: 42,
      fileId: "image-later",
      filename: "later.png",
      mimeType: "image/png",
      caption: "Second caption",
    });
    const earlierMessage = createDocumentContext({
      messageId: 41,
      fileId: "image-earlier",
      filename: "earlier.png",
      mimeType: "image/png",
      caption: "First caption",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, laterMessage.ctx);
    await addToHandler(handler, earlierMessage.ctx);
    await handler.flushAll();

    expect(processPromptMock).toHaveBeenCalledWith(
      earlierMessage.ctx,
      "First caption\n\nSecond caption",
      deps,
      expect.any(Array),
    );
  });

  it("does not let a later album submit before an earlier album finishes", async () => {
    let releaseFirst: () => void = () => {};
    const processPromptMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirst = () => resolve(true);
          }),
      )
      .mockResolvedValue(true);
    const { deps } = createDeps({ processPrompt: processPromptMock });
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 1 });
    const first = createPhotoContext({
      messageId: 10,
      smallFileId: "first-small",
      largeFileId: "first-large",
    });
    const second = createPhotoContext({
      messageId: 20,
      smallFileId: "second-small",
      largeFileId: "second-large",
    });
    second.ctx.message!.media_group_id = "album-2";

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    const flushing = handler.flushAll();

    await vi.waitFor(() => expect(processPromptMock).toHaveBeenCalledTimes(1));
    releaseFirst();
    await flushing;

    expect(processPromptMock).toHaveBeenCalledTimes(2);
    expect(processPromptMock.mock.calls[0]?.[0]).toBe(first.ctx);
    expect(processPromptMock.mock.calls[1]?.[0]).toBe(second.ctx);
  });

  it("rejects the whole media group when any file is unsupported", async () => {
    const image = createDocumentContext({
      messageId: 50,
      fileId: "image-file",
      filename: "screen.png",
      mimeType: "image/png",
    });
    const archive = createDocumentContext({
      messageId: 51,
      fileId: "archive-file",
      filename: "archive.zip",
      mimeType: "application/zip",
    });
    const { deps, processPromptMock, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, image.ctx);
    await addToHandler(handler, archive.ctx);
    await handler.flushAll();

    expect(image.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("rejects the whole media group when the model lacks image support", async () => {
    const image = createDocumentContext({
      messageId: 60,
      fileId: "image-file",
      filename: "screen.png",
      mimeType: "image/png",
    });
    const { deps, processPromptMock, downloadMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: false, pdf: true } }),
    });
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, image.ctx);
    await handler.flushAll();

    expect(image.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported non-document media in a media group", async () => {
    const unsupported = createUnsupportedMediaContext(70);
    const { deps, processPromptMock, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, unsupported.ctx);
    await handler.flushAll();

    expect(unsupported.replyMock).toHaveBeenCalledWith(t("bot.message_type_unsupported"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("waits for the debounce window before sending the prompt", async () => {
    vi.useFakeTimers();
    const image = createDocumentContext({
      messageId: 80,
      fileId: "image-file",
      filename: "screen.png",
      mimeType: "image/png",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 500 });

    await addToHandler(handler, image.ctx);
    expect(processPromptMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(499);
    expect(processPromptMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(processPromptMock).toHaveBeenCalledTimes(1);
  });
});
