import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

import {
  handleDocumentMessage,
  type DocumentHandlerDeps,
} from "../../../src/bot/handlers/document-handler.js";
import { MAX_FILE_SIZE_BYTES } from "../../../src/app/services/file-download-service.js";

vi.mock("../../../src/app/services/document-extractor-service.js", () => ({
  isDocExtractorConfigured: vi.fn(),
  extractDocument: vi.fn(),
}));
import { t } from "../../../src/i18n/index.js";
import { isDocExtractorConfigured } from "../../../src/app/services/document-extractor-service.js";
import { MAX_QUEUED_MEDIA_BYTES, promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";
import { initializePromptQueueDispatch } from "../../../src/bot/handlers/prompt-queue-dispatch.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

function createDocumentContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    message: {
      document: {
        file_id: "doc-file-id",
        file_unique_id: "unique-id",
        file_name: "test.txt",
        mime_type: "text/plain",
        file_size: 1024,
      },
      caption: "",
      ...overrides,
    },
    reply: replyMock,
    api: {
      getFile: vi.fn().mockResolvedValue({
        file_path: "documents/test.txt",
        file_size: 1024,
      }),
    },
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDocumentDeps(overrides: Partial<DocumentHandlerDeps> = {}): {
  deps: DocumentHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  saveFileMock: ReturnType<typeof vi.fn>;
  getCapabilitiesMock: ReturnType<typeof vi.fn>;
  getStoredModelMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("file content here"),
    filePath: "documents/test.txt",
  });
  const saveFileMock = vi.fn(async (_buffer: Buffer, filename: string) => ({
    filePath: `/bot/inbox/1-abc/${filename}`,
    filename,
  }));
  const getCapabilitiesMock = vi.fn().mockResolvedValue({
    input: { pdf: true, image: true },
  });
  const getStoredModelMock = vi.fn().mockReturnValue({
    providerID: "test-provider",
    modelID: "test-model",
  });

  const deps: DocumentHandlerDeps = {
    ...container,
    bot: {} as DocumentHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    saveFile: saveFileMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: getStoredModelMock,
    processPrompt: (ctx, input, promptDeps) =>
      input.fileParts.length > 0
        ? processPromptMock(ctx, input.text, promptDeps, input.fileParts)
        : processPromptMock(ctx, input.text, promptDeps),
    ...overrides,
  };
  initializePromptQueueDispatch(deps);

  return {
    deps,
    processPromptMock,
    downloadMock,
    saveFileMock,
    getCapabilitiesMock,
    getStoredModelMock,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/handlers/document", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
    promptQueue.__resetForTests();
  });

  it("rejects oversized queued image documents before downloading", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createDocumentContext({
      document: {
        file_id: "image-file-id",
        file_unique_id: "image-unique-id",
        file_name: "image.png",
        mime_type: "image/png",
        file_size: MAX_QUEUED_MEDIA_BYTES + 1,
      },
    });
    const { deps, downloadMock, processPromptMock } = createDocumentDeps();

    await handleDocumentMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("rejects oversized queued PDFs before downloading", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createDocumentContext({
      document: {
        file_id: "pdf-file-id",
        file_unique_id: "pdf-unique-id",
        file_name: "large.pdf",
        mime_type: "application/pdf",
        file_size: MAX_QUEUED_MEDIA_BYTES + 1,
      },
    });
    const { deps, downloadMock, processPromptMock } = createDocumentDeps();

    await handleDocumentMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("rejects queued documents with an unknown media size", async () => {
    vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createDocumentContext({
      document: {
        file_id: "unknown-file-id",
        file_unique_id: "unknown-unique-id",
        file_name: "unknown.png",
        mime_type: "image/png",
      },
    });
    const { deps, downloadMock } = createDocumentDeps();

    await handleDocumentMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(promptQueue.mediaSize()).toBe(0);
  });

  describe("text files", () => {
    it("reserves raw source bytes when a text file is queued", async () => {
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      const { ctx } = createDocumentContext();
      const { deps, downloadMock, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(downloadMock).toHaveBeenCalledOnce();
      expect(processPromptMock).not.toHaveBeenCalled();
      expect(promptQueue.list()).toEqual([
        expect.objectContaining({
          mediaBytes: 1024,
        }),
      ]);
      expect(promptQueue.mediaSize()).toBe(1024);
    });

    it("downloads and sends text file content as prompt", async () => {
      const { ctx, replyMock } = createDocumentContext();
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        "--- Content of test.txt ---\nfile content here\n--- End of file ---\n\n",
        deps,
      );
    });

    it("includes caption in prompt after file content", async () => {
      const { ctx } = createDocumentContext({ caption: "Please review this file" });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Please review this file"),
        deps,
      );
    });

    it("rejects text file larger than limit", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "large.txt",
          mime_type: "text/plain",
          file_size: 200 * 1024, // 200KB
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.text_file_too_large", { maxSizeKb: "100" }));
      expect(downloadMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });

    it("accepts application/json as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "config.json",
          mime_type: "application/json",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });

    it("accepts application/xml as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "data.xml",
          mime_type: "application/xml",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });

    it("accepts application/javascript as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "script.js",
          mime_type: "application/javascript",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });
  });

  describe("PDF files", () => {
    it("downloads and sends PDF when model supports it", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        "",
        deps,
        expect.arrayContaining([
          expect.objectContaining({ type: "file", mime: "application/pdf" }),
        ]),
      );
    });

    it("saves the PDF locally when the model does not support PDF", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, downloadMock, saveFileMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("file content here"), "document.pdf");
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/document.pdf"),
        deps,
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("not a model attachment"),
        deps,
      );
    });

    it("keeps the caption when the PDF is saved locally", async () => {
      const { ctx } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
        caption: "Summarize this document",
      });
      const { deps, processPromptMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Summarize this document"),
        deps,
      );
    });
  });

  describe("image files", () => {
    it("downloads and sends image documents when model supports images", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "image-file-id",
          file_unique_id: "image-unique-id",
          file_name: "photo.png",
          mime_type: "image/png",
          file_size: 5000,
        },
        caption: "Describe this image",
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        "Describe this image",
        deps,
        expect.arrayContaining([
          expect.objectContaining({
            type: "file",
            mime: "image/png",
            filename: "photo.png",
            url: expect.stringMatching(/^data:image\/png;base64,/),
          }),
        ]),
      );
    });

    it("shows error when model does not support images", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "image-file-id",
          file_unique_id: "image-unique-id",
          file_name: "photo.png",
          mime_type: "image/png",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { image: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.photo_model_no_image"));
      expect(downloadMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });

    it("sends caption-only when model does not support images but caption exists", async () => {
      const { ctx } = createDocumentContext({
        document: {
          file_id: "image-file-id",
          file_unique_id: "image-unique-id",
          file_name: "photo.png",
          mime_type: "image/png",
          file_size: 5000,
        },
        caption: "Describe this image",
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { image: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(downloadMock).not.toHaveBeenCalled();
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "Describe this image", deps);
    });

    it.each([
      ["photo.jpg", "image/jpeg"],
      ["photo.JPEG", "image/jpeg"],
      ["photo.png", "image/png"],
      ["photo.webp", "image/webp"],
      ["photo.gif", "image/gif"],
    ])(
      "sends octet-stream %s as an image with MIME type %s",
      async (fileName, expectedMimeType) => {
        const { ctx } = createDocumentContext({
          document: {
            file_id: "image-file-id",
            file_unique_id: "image-unique-id",
            file_name: fileName,
            mime_type: "application/octet-stream",
            file_size: 5000,
          },
        });
        const { deps, processPromptMock } = createDocumentDeps();

        await handleDocumentMessage(ctx, deps);

        expect(processPromptMock).toHaveBeenCalledWith(ctx, "", deps, [
          expect.objectContaining({
            type: "file",
            mime: expectedMimeType,
            filename: fileName,
            url: expect.stringMatching(new RegExp(`^data:${expectedMimeType};base64,`)),
          }),
        ]);
      },
    );

    it("saves octet-stream files without an image extension locally", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "bin-file-id",
          file_unique_id: "bin-unique-id",
          file_name: "firmware.bin",
          mime_type: "application/octet-stream",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, saveFileMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("file content here"), "firmware.bin");
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/firmware.bin"),
        deps,
      );
    });

    it("routes a PDF named with an image extension by its PDF MIME type", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "report.png",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: true, image: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).not.toHaveBeenCalledWith(t("bot.photo_model_no_image"));
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "", deps, [
        expect.objectContaining({
          type: "file",
          mime: "application/pdf",
          filename: "report.png",
          url: expect.stringMatching(/^data:application\/pdf;base64,/),
        }),
      ]);
    });
  });

  describe("document extraction via DOC_EXTRACTOR_URL", () => {
    beforeEach(() => {
      vi.mocked(isDocExtractorConfigured).mockReturnValue(true);
    });

    it("extracts and sends PDF text when model does not support PDF and extractor is configured", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      const { extractDocument: extractDoc } =
        await import("../../../src/app/services/document-extractor-service.js");
      vi.mocked(extractDoc).mockResolvedValue({ text: "Extracted PDF content" });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(extractDoc).toHaveBeenCalledWith(
        expect.any(Buffer),
        "application/pdf",
        "document.pdf",
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Extracted PDF content"),
        deps,
      );
    });

    it("extracts DOCX when model does not support PDF input", async () => {
      const { ctx } = createDocumentContext({
        document: {
          file_id: "docx-file-id",
          file_unique_id: "docx-unique-id",
          file_name: "report.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      const { extractDocument: extractDoc } =
        await import("../../../src/app/services/document-extractor-service.js");
      vi.mocked(extractDoc).mockResolvedValue({ text: "DOCX content" });

      await handleDocumentMessage(ctx, deps);

      expect(extractDoc).toHaveBeenCalledWith(
        expect.any(Buffer),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "report.docx",
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("DOCX content"),
        deps,
      );
    });

    it("saves the document locally after extraction fails and keeps the caption", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
        caption: "Summarize this",
      });
      const { deps, processPromptMock, saveFileMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      const { extractDocument: extractDoc } =
        await import("../../../src/app/services/document-extractor-service.js");
      vi.mocked(extractDoc).mockRejectedValue(new Error("API unreachable"));

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.document_extraction_error"));
      expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("file content here"), "document.pdf");
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/document.pdf"),
        deps,
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Summarize this"),
        deps,
      );
    });

    it("saves the document locally after extraction fails without a caption", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
        caption: "",
      });
      const { deps, processPromptMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      const { extractDocument: extractDoc } =
        await import("../../../src/app/services/document-extractor-service.js");
      vi.mocked(extractDoc).mockRejectedValue(new Error("API unreachable"));

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.document_extraction_error"));
      expect(processPromptMock).toHaveBeenCalledOnce();
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/document.pdf"),
        deps,
      );
    });

    it("saves the document locally when the extractor is not configured", async () => {
      vi.mocked(isDocExtractorConfigured).mockReturnValue(false);

      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
        caption: "Summarize",
      });
      const { deps, processPromptMock, saveFileMock } = createDocumentDeps({
        getModelCapabilities: vi.fn().mockResolvedValue({
          input: { pdf: false },
        }),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("file content here"), "document.pdf");
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/document.pdf"),
        deps,
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Summarize"),
        deps,
      );
    });
  });

  describe("unsupported file types", () => {
    it("saves the file locally and hands its path to the agent", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: 5000,
        },
        caption: "Unpack this archive",
      });
      const { deps, processPromptMock, downloadMock, saveFileMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalledWith(ctx.api, "zip-file-id");
      expect(saveFileMock).toHaveBeenCalledWith(Buffer.from("file content here"), "archive.zip");
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("/bot/inbox/1-abc/archive.zip"),
        deps,
      );
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("Unpack this archive"),
        deps,
      );
    });

    it("queues a locally saved file without holding its bytes in memory", async () => {
      vi.spyOn(settingsStore, "getPromptQueueMode").mockReturnValue("queue");
      container.foregroundSessionState.markBusy("session-1", "/repo");
      const { ctx } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: MAX_QUEUED_MEDIA_BYTES,
        },
        caption: "Check later",
      });
      const { deps, processPromptMock, saveFileMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(saveFileMock).toHaveBeenCalledOnce();
      expect(processPromptMock).not.toHaveBeenCalled();
      expect(promptQueue.size()).toBe(1);
      expect(promptQueue.list()[0]).toEqual(
        expect.objectContaining({ displayText: "Check later", mediaBytes: 0 }),
      );
      expect(promptQueue.mediaSize()).toBe(0);
    });

    it("rejects a file above the Telegram Bot API download limit", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "huge.zip",
          mime_type: "application/zip",
          file_size: MAX_FILE_SIZE_BYTES + 1,
        },
      });
      const { deps, processPromptMock, downloadMock, saveFileMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_too_large", { maxSizeMb: "20" }));
      expect(downloadMock).not.toHaveBeenCalled();
      expect(saveFileMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });

    it("reports a save failure and forwards the caption", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: 5000,
        },
        caption: "Check this",
      });
      const { deps, processPromptMock } = createDocumentDeps({
        saveFile: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_save_error"));
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "Check this", deps);
    });

    it("does not fall back to anything when the save fails without a caption", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps({
        saveFile: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_save_error"));
      expect(processPromptMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("shows download error when file download fails", async () => {
      const { ctx, replyMock } = createDocumentContext();
      const { deps } = createDocumentDeps({
        downloadFile: vi.fn().mockRejectedValue(new Error("Network error")),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_download_error"));
    });

    it("shows download error when an unsupported file cannot be downloaded", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: 5000,
        },
      });
      const { deps, saveFileMock, processPromptMock } = createDocumentDeps({
        downloadFile: vi.fn().mockRejectedValue(new Error("Network error")),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_download_error"));
      expect(saveFileMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });
  });

  describe("missing document", () => {
    it("returns early when no document in message", async () => {
      const ctx = { chat: { id: 777 }, message: {} } as unknown as Context;
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(processPromptMock).not.toHaveBeenCalled();
    });
  });
});
