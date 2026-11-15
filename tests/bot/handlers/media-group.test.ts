import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());
const serverVersion = vi.hoisted(() => ({ value: "v1" as "v1" | "v2" }));

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/opencode/client.js")>()),
  get opencodeServerVersion() {
    return serverVersion.value;
  },
}));

import {
  MediaGroupAttachmentHandler,
  type MediaGroupHandlerDeps,
} from "../../../src/bot/handlers/media-group-handler.js";
import { t } from "../../../src/i18n/index.js";
import { MAX_FILE_SIZE_BYTES } from "../../../src/app/services/file-download-service.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { MAX_QUEUED_MEDIA_BYTES } from "../../../src/app/managers/prompt-queue-manager.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";
import { initializePromptQueueDispatch } from "../../../src/bot/handlers/prompt-queue-dispatch.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { config } from "../../../src/config.js";

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
  saveFileMock: ReturnType<typeof vi.fn>;
  getCapabilitiesMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn(async (_api: Context["api"], fileId: string) => ({
    buffer: Buffer.from(`content:${fileId}`),
    filePath: `documents/${fileId}`,
  }));
  const saveFileMock = vi.fn(async (_buffer: Buffer, filename: string) => ({
    filePath: `/bot/inbox/1-abc/${filename}`,
    filename,
  }));
  const getCapabilitiesMock = vi.fn().mockResolvedValue({
    input: { image: true, pdf: true },
  });

  const deps: MediaGroupHandlerDeps = {
    ...container,
    bot: {} as MediaGroupHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    saveFile: saveFileMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: vi.fn(() => ({ providerID: "test-provider", modelID: "test-model" })),
    processPrompt: (ctx, input, promptDeps) =>
      processPromptMock(ctx, input.text, promptDeps, input.fileParts),
    ...overrides,
  };
  initializePromptQueueDispatch(deps);

  return { deps, processPromptMock, downloadMock, saveFileMock, getCapabilitiesMock };
}

async function addToHandler(handler: MediaGroupAttachmentHandler, ctx: Context): Promise<void> {
  const next = vi.fn() as unknown as NextFunction;
  await handler.handle(ctx, next);
  expect(next).not.toHaveBeenCalled();
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/handlers/media-group", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
    promptQueue.__resetForTests();
    serverVersion.value = "v1";
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
    expect(processPromptMock).toHaveBeenCalledWith(first.ctx, "What is on these images?", deps, [
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
    ]);
  });

  it("queues an album as one item while the agent is busy", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
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
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
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

  it.each([MAX_QUEUED_MEDIA_BYTES, MAX_QUEUED_MEDIA_BYTES - 512])(
    "rejects a text album before preparation with %i bytes already queued",
    async (heldBytes) => {
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      expect(
        promptQueue.add({ ...createIncomingPrompt("held"), mediaBytes: heldBytes }),
      ).not.toBeNull();
      const text = createDocumentContext({
        messageId: 20,
        fileId: "text-file",
        filename: "notes.txt",
        mimeType: "text/plain",
        fileSize: 1024,
      });
      const { deps, downloadMock, saveFileMock, processPromptMock } = createDeps();
      const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

      await addToHandler(handler, text.ctx);
      await handler.flushAll();

      expect(text.replyMock).toHaveBeenCalledWith(
        t("queue.media_limit", { maxSizeMb: "20" }),
        expect.any(Object),
      );
      expect(downloadMock).not.toHaveBeenCalled();
      expect(saveFileMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
      expect(promptQueue.size()).toBe(1);
      expect(promptQueue.mediaSize()).toBe(heldBytes);
    },
  );

  it("retains text album bytes at the exact remaining budget until removal", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const heldBytes = MAX_QUEUED_MEDIA_BYTES - 2048;
    expect(
      promptQueue.add({ ...createIncomingPrompt("held"), mediaBytes: heldBytes }),
    ).not.toBeNull();
    const first = createDocumentContext({
      messageId: 20,
      fileId: "text-1",
      filename: "first.txt",
      mimeType: "text/plain",
    });
    const second = createDocumentContext({
      messageId: 21,
      fileId: "text-2",
      filename: "second.txt",
      mimeType: "text/plain",
    });
    const { deps, downloadMock, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, first.ctx);
    await addToHandler(handler, second.ctx);
    await handler.flushAll();

    expect(processPromptMock).not.toHaveBeenCalled();
    expect(downloadMock).toHaveBeenCalledTimes(2);
    expect(promptQueue.size()).toBe(2);
    const album = promptQueue.list()[1];
    expect(album?.mediaBytes).toBe(2048);
    expect(promptQueue.mediaSize()).toBe(MAX_QUEUED_MEDIA_BYTES);
    expect(promptQueue.canAcceptMedia(1)).toBe(false);
    expect(promptQueue.removeById(album!.id)?.mediaBytes).toBe(2048);
    expect(promptQueue.mediaSize()).toBe(heldBytes);
    expect(promptQueue.canAcceptMedia(2048)).toBe(true);
  });

  it.each([false, true])(
    "counts text and native bytes but not stored bytes in a mixed album (overflow=%s)",
    async (overflow) => {
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      const heldBytes = MAX_QUEUED_MEDIA_BYTES - 1536;
      expect(
        promptQueue.add({ ...createIncomingPrompt("held"), mediaBytes: heldBytes }),
      ).not.toBeNull();
      const archive = createDocumentContext({
        messageId: 20,
        fileId: "archive-file",
        filename: "archive.zip",
        mimeType: "application/zip",
        fileSize: MAX_QUEUED_MEDIA_BYTES,
      });
      const image = createPhotoContext({
        messageId: 21,
        smallFileId: "small",
        largeFileId: "large",
        fileSize: 512,
      });
      const text = createDocumentContext({
        messageId: 22,
        fileId: "text-file",
        filename: "notes.txt",
        mimeType: "text/plain",
        fileSize: overflow ? 1025 : 1024,
      });
      const { deps, downloadMock, saveFileMock, processPromptMock } = createDeps();
      const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

      await addToHandler(handler, archive.ctx);
      await addToHandler(handler, image.ctx);
      await addToHandler(handler, text.ctx);
      await handler.flushAll();

      expect(processPromptMock).not.toHaveBeenCalled();
      if (overflow) {
        expect(archive.replyMock).toHaveBeenCalledWith(
          t("queue.media_limit", { maxSizeMb: "20" }),
          expect.any(Object),
        );
        expect(downloadMock).not.toHaveBeenCalled();
        expect(saveFileMock).not.toHaveBeenCalled();
        expect(promptQueue.size()).toBe(1);
        expect(promptQueue.mediaSize()).toBe(heldBytes);
      } else {
        expect(downloadMock).toHaveBeenCalledTimes(3);
        expect(saveFileMock).toHaveBeenCalledTimes(1);
        expect(promptQueue.size()).toBe(2);
        expect(promptQueue.list()[1]?.mediaBytes).toBe(1536);
        expect(promptQueue.mediaSize()).toBe(MAX_QUEUED_MEDIA_BYTES);
      }
    },
  );

  it.each([undefined, NaN, -1, 0.5, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unreliable text size %s before downloading or saving the album",
    async (fileSize) => {
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      const text = createBaseContext({
        message_id: 20,
        document: {
          file_id: "invalid-text",
          file_unique_id: "invalid-text-unique",
          file_name: "notes.txt",
          mime_type: "text/plain",
          file_size: fileSize,
        },
      });
      const image = createPhotoContext({
        messageId: 21,
        smallFileId: "small",
        largeFileId: "large",
      });
      const otherText = createDocumentContext({
        messageId: 22,
        fileId: "other-text",
        filename: "other.txt",
        mimeType: "text/plain",
        fileSize: fileSize === 0.5 ? 0.5 : 1024,
      });
      const { deps, downloadMock, saveFileMock, processPromptMock } = createDeps();
      const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

      await addToHandler(handler, text.ctx);
      await addToHandler(handler, image.ctx);
      await addToHandler(handler, otherText.ctx);
      await handler.flushAll();

      expect(text.replyMock).toHaveBeenCalledWith(
        t("queue.media_limit", { maxSizeMb: "20" }),
        expect.any(Object),
      );
      expect(downloadMock).not.toHaveBeenCalled();
      expect(saveFileMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
      expect(promptQueue.size()).toBe(0);
      expect(promptQueue.mediaSize()).toBe(0);
    },
  );

  it("accepts a zero-byte text album without consuming media budget", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const text = createDocumentContext({
      messageId: 20,
      fileId: "empty-text",
      filename: "empty.txt",
      mimeType: "text/plain",
      fileSize: 0,
    });
    const { deps, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, text.ctx);
    await handler.flushAll();

    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(promptQueue.size()).toBe(1);
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("preserves the individual text-file limit", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const text = createDocumentContext({
      messageId: 20,
      fileId: "large-text",
      filename: "large.txt",
      mimeType: "text/plain",
      fileSize: config.files.maxFileSizeKb * 1024 + 1,
    });
    const { deps, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, text.ctx);
    await handler.flushAll();

    expect(text.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(promptQueue.size()).toBe(0);
  });

  it.each(["idle", "off"] as const)("preserves text-size validation when %s", async (mode) => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue(mode === "off" ? "off" : "queue");
    if (mode === "off") {
      container.foregroundSessionState.markBusy("session-1", "/repo");
    }
    const text = createDocumentContext({
      messageId: 20,
      fileId: "invalid-text",
      filename: "notes.txt",
      mimeType: "text/plain",
      fileSize: Infinity,
    });
    const { deps, downloadMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, text.ctx);
    await handler.flushAll();

    expect(text.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
    expect(text.replyMock).not.toHaveBeenCalledWith(
      t("queue.media_limit", { maxSizeMb: "20" }),
      expect.any(Object),
    );
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it.each([
    ["v1", Infinity],
    ["v2", Infinity],
    ["v2", Number.MAX_SAFE_INTEGER + 1],
  ] as const)(
    "preserves invalid text-size notice precedence with a full %s queue (size=%s)",
    async (version, fileSize) => {
      serverVersion.value = version;
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      while (!promptQueue.isFull()) {
        expect(promptQueue.add(createIncomingPrompt("held"))).not.toBeNull();
      }
      const text = createDocumentContext({
        messageId: 20,
        fileId: "invalid-text",
        filename: "notes.txt",
        mimeType: "text/plain",
        fileSize,
      });
      const { deps, downloadMock } = createDeps();
      const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

      await addToHandler(handler, text.ctx);
      await handler.flushAll();

      if (version === "v2") {
        expect(text.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
      } else {
        expect(text.replyMock).toHaveBeenCalledWith(
          t("queue.full", { max: "5" }),
          expect.any(Object),
        );
      }
      expect(downloadMock).not.toHaveBeenCalled();
    },
  );

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
    expect(processPromptMock).toHaveBeenCalledWith(first.ctx, "Compare these photos", deps, [
      expect.objectContaining({ mime: "image/jpeg", filename: "photo-20.jpg" }),
      expect.objectContaining({ mime: "image/jpeg", filename: "photo-21.jpg" }),
    ]);
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

  it("saves unsupported documents in an album locally", async () => {
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
      caption: "Look inside the archive",
    });
    const { deps, processPromptMock, downloadMock, saveFileMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, image.ctx);
    await addToHandler(handler, archive.ctx);
    await handler.flushAll();

    expect(image.replyMock).toHaveBeenCalledWith(t("bot.files_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(archive.ctx.api, "archive-file");
    expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("content:archive-file"), "archive.zip");
    expect(processPromptMock).toHaveBeenCalledWith(
      image.ctx,
      expect.stringContaining("/bot/inbox/1-abc/archive.zip"),
      deps,
      [expect.objectContaining({ filename: "screen.png" })],
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      image.ctx,
      expect.stringContaining("Look inside the archive"),
      deps,
      expect.any(Array),
    );
  });

  it("saves PDFs in an album locally when the model lacks PDF support", async () => {
    const image = createDocumentContext({
      messageId: 55,
      fileId: "image-file",
      filename: "screen.png",
      mimeType: "image/png",
    });
    const pdf = createDocumentContext({
      messageId: 56,
      fileId: "pdf-file",
      filename: "spec.pdf",
      mimeType: "application/pdf",
      caption: "Compare these",
    });
    const { deps, processPromptMock, saveFileMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: true, pdf: false } }),
    });
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, image.ctx);
    await addToHandler(handler, pdf.ctx);
    await handler.flushAll();

    expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("content:pdf-file"), "spec.pdf");
    expect(processPromptMock).toHaveBeenCalledWith(
      image.ctx,
      expect.stringContaining("/bot/inbox/1-abc/spec.pdf"),
      deps,
      [expect.objectContaining({ filename: "screen.png" })],
    );
  });

  it("does not count locally saved documents against the queued media limit", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const archive = createDocumentContext({
      messageId: 22,
      fileId: "archive-file",
      filename: "archive.zip",
      mimeType: "application/zip",
      fileSize: MAX_QUEUED_MEDIA_BYTES,
      caption: "Check the archive",
    });
    const { deps, processPromptMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, archive.ctx);
    await handler.flushAll();

    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.size()).toBe(1);
    expect(promptQueue.list()[0]).toEqual(
      expect.objectContaining({ displayText: "Check the archive" }),
    );
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("reports a local save failure clearly and sends nothing", async () => {
    const archive = createDocumentContext({
      messageId: 59,
      fileId: "archive-file",
      filename: "archive.zip",
      mimeType: "application/zip",
    });
    const { deps, processPromptMock } = createDeps({
      saveFile: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
    });
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, archive.ctx);
    await handler.flushAll();

    expect(archive.replyMock).toHaveBeenCalledWith(t("bot.file_save_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("rejects the whole media group when a document exceeds the Telegram download limit", async () => {
    const archive = createDocumentContext({
      messageId: 58,
      fileId: "archive-file",
      filename: "huge.zip",
      mimeType: "application/zip",
      fileSize: MAX_FILE_SIZE_BYTES + 1,
    });
    const { deps, processPromptMock, downloadMock, saveFileMock } = createDeps();
    const handler = new MediaGroupAttachmentHandler(deps, { debounceMs: 10_000 });

    await addToHandler(handler, archive.ctx);
    await handler.flushAll();

    expect(archive.replyMock).toHaveBeenCalledWith(t("bot.media_group_not_processed"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(saveFileMock).not.toHaveBeenCalled();
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
