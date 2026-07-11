import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

import { handlePhotoMessage, type PhotoHandlerDeps } from "../../../src/bot/handlers/photo-handler.js";
import { t } from "../../../src/i18n/index.js";

function createPhotoContext(caption = "Describe this"): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 100 });
  const ctx = {
    chat: { id: 777 },
    message: {
      caption,
      photo: [
        { file_id: "small-photo", file_unique_id: "small", width: 320, height: 240 },
        { file_id: "large-photo", file_unique_id: "large", width: 1280, height: 960 },
      ],
    },
    reply: replyMock,
    api: {},
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDeps(overrides: Partial<PhotoHandlerDeps> = {}): {
  deps: PhotoHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  getCapabilitiesMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("photo-bytes"),
    filePath: "photos/file.jpg",
  });
  const getCapabilitiesMock = vi.fn().mockResolvedValue({ input: { image: true } });
  const deps: PhotoHandlerDeps = {
    bot: {} as PhotoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: vi.fn(() => ({ providerID: "test-provider", modelID: "test-model" })),
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, getCapabilitiesMock };
}

describe("bot/handlers/photo-handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
  });

  it("downloads the largest photo and sends it as a file part", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock, downloadMock } = createDeps();

    await handlePhotoMessage(ctx, deps);

    expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).toHaveBeenCalledWith(t("bot.photo_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "large-photo");
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "Describe this",
      deps,
      [
        expect.objectContaining({
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
          url: expect.stringMatching(/^data:image\/jpeg;base64,/),
        }),
      ],
    );
  });

  it("falls back to caption-only when the model does not support images", async () => {
    const { ctx, replyMock } = createPhotoContext("Use this caption");
    const { deps, processPromptMock, downloadMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: false } }),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.photo_model_no_image"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "Use this caption", deps);
  });
});
