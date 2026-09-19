import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

import { handlePhotoMessage, type PhotoHandlerDeps } from "../../../src/bot/handlers/photo-handler.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";
import { initializePromptQueueDispatch } from "../../../src/bot/handlers/prompt-queue-dispatch.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

function createPhotoContext(caption = "Describe this"): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 100 });
  const ctx = {
    chat: { id: 777 },
    message: {
      caption,
      photo: [
        { file_id: "small-photo", file_unique_id: "small", width: 320, height: 240 },
        { file_id: "large-photo", file_unique_id: "large", width: 1280, height: 960, file_size: 512 },
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
    ...container,
    bot: {} as PhotoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: vi.fn(() => ({ providerID: "test-provider", modelID: "test-model" })),
    processPrompt: processPromptMock,
    ...overrides,
  };
  initializePromptQueueDispatch(deps);

  return { deps, processPromptMock, downloadMock, getCapabilitiesMock };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/handlers/photo-handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
    promptQueue.__resetForTests();
  });

  it("queues a photo without downloading it while the agent is busy", async () => {
    vi.spyOn(settingsStore, "getPromptQueueEnabled").mockReturnValue(true);
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createPhotoContext("release screenshot");
    const { deps, processPromptMock } = createDeps();

    await handlePhotoMessage(ctx, deps);

    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.list()).toEqual([
      expect.objectContaining({
        text: "release screenshot",
        displayText: "release screenshot",
        photos: [expect.objectContaining({ filename: "photo.jpg", fileId: "large-photo" })],
        mediaBytes: 512,
      }),
    ]);
  });

  it("passes the largest photo to the shared prompt pipeline", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock, downloadMock, getCapabilitiesMock } = createDeps();

    await handlePhotoMessage(ctx, deps);

    expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
    expect(getCapabilitiesMock).not.toHaveBeenCalled();
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      createIncomingPrompt("Describe this", {
        photos: [
          {
            fileId: "large-photo",
            filename: "photo.jpg",
            source: "standalone",
          },
        ],
      }),
      deps,
    );
  });

  it("keeps a photo-only prompt when the caption is empty", async () => {
    const { ctx } = createPhotoContext("");
    const { deps, processPromptMock } = createDeps();

    await handlePhotoMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      createIncomingPrompt("", {
        photos: [
          {
            fileId: "large-photo",
            filename: "photo.jpg",
            source: "standalone",
          },
        ],
      }),
      deps,
    );
  });
});
