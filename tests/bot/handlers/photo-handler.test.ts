import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { foregroundSessionState } from "#src/app/managers/foreground-session-state-manager.js";
import * as settingsStore from "#src/app/stores/settings-store.js";
import type { PhotoHandlerDeps } from "#src/bot/handlers/photo-handler.js";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("#src/bot/handlers/message-merger.ts", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

const configMock = {
  telegram: {
    token: "bot-token-xyz",
    allowedUserId: 123456789,
    apiRoot: "",
    proxyUrl: "",
    proxySecret: "",
    forceIpv4: false,
  },
  opencode: {
    apiUrl: "http://localhost:4096",
    username: "opencode",
    password: "",
    autoRestartEnabled: false,
    monitorIntervalSec: 300,
    model: {
      provider: "test-provider",
      modelId: "test-model",
    },
  },
  server: {
    logLevel: "info",
  },
  bot: {
    sessionsListLimit: 10,
    messagesListLimit: 10,
    projectsListLimit: 10,
    commandsListLimit: 10,
    taskLimit: 10,
    scheduledTaskExecutionTimeoutMinutes: 120,
    scheduledTaskNotificationsSilent: false,
    responseStreamingMode: "edit",
    bashToolDisplayMaxLength: 128,
    locale: "en",
    hideThinkingMessages: false,
    hideToolCallMessages: false,
    hideToolFileMessages: false,
    trackBackgroundSessions: true,
    messageFormatMode: "markdown",
    excludedProjectPaths: [],
  },
  files: {
    maxFileSizeKb: 100,
  },
  open: {
    browserRoots: "",
  },
  stt: {
    apiUrl: "",
    apiKey: "",
    model: "whisper-large-v3-turbo",
    language: "",
    notePrompt: "",
  },
  vision: {
    apiUrl: "http://127.0.0.1:8082/v1",
    model: "lfm2.5-vl-3b",
    uploadDir: "/home/test/.opencode/uploads",
  },
  tts: {
    apiUrl: "",
    apiKey: "",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voice: "alloy",
  },
};

vi.mock("#src/config.ts", () => ({
  config: configMock,
}));

const { handlePhotoMessage } = await loadSut<typeof import("#src/bot/handlers/photo-handler.js")>(
  "#src/bot/handlers/photo-handler.ts",
  import.meta.url,
);

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
    promptQueue.__resetForTests();
    foregroundSessionState.__resetForTests();
  });

  it("queues a photo without downloading it while the agent is busy", async () => {
    vi.spyOn(settingsStore, "getPromptQueueEnabled").mockReturnValue(true);
    foregroundSessionState.markBusy("session-1", "/repo");
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
