import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import type { VideoHandlerDeps } from "#src/bot/handlers/video-handler.js";

const { handleVideoMessage } = await loadSut<typeof import("#src/bot/handlers/video-handler.js")>(
  "#src/bot/handlers/video-handler.ts",
  import.meta.url,
);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("#src/bot/handlers/message-merger.ts", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { foregroundSessionState } from "#src/app/managers/foreground-session-state-manager.js";
import * as settingsStore from "#src/app/stores/settings-store.js";

const SAVED_VIDEO_PATH = "/tmp/uploads/video-1234567890.mp4";

function createVideoContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    message: {
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        file_name: "VID_20260918_194154.mp4",
        mime_type: "video/mp4",
        file_size: 5_000_000,
        duration: 42,
        width: 1920,
        height: 1080,
      },
      caption: "",
      ...overrides,
    },
    reply: replyMock,
    api: {
      getFile: vi.fn().mockResolvedValue({
        file_path: "videos/file_0.mp4",
        file_size: 5_000_000,
      }),
    },
  } as unknown as Context;

  return { ctx, replyMock };
}

function createVideoDeps(overrides: Partial<VideoHandlerDeps> = {}): {
  deps: VideoHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  saveVideoMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("fake-video-data"),
    filePath: "videos/file_0.mp4",
  });
  const saveVideoMock = vi.fn().mockResolvedValue(SAVED_VIDEO_PATH);

  const deps: VideoHandlerDeps = {
    bot: {} as VideoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    saveVideo: saveVideoMock,
    processPrompt: (ctx, input, promptDeps) => processPromptMock(ctx, input.text, promptDeps),
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, saveVideoMock };
}

describe("bot/handlers/video", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
    promptQueue.__resetForTests();
    foregroundSessionState.__resetForTests();
  });

  it("saves the video and appends the on-disk path note to the caption", async () => {
    const { ctx, replyMock } = createVideoContext({ caption: "Vídeo de la tienda" });
    const { deps, processPromptMock, downloadMock, saveVideoMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "video-file-id");
    expect(saveVideoMock).toHaveBeenCalledWith(expect.any(Buffer), "mp4");
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining("Vídeo de la tienda"),
      deps,
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining(SAVED_VIDEO_PATH),
      deps,
    );
  });

  it("sends the path note alone when the video has no caption", async () => {
    const { ctx } = createVideoContext();
    const { deps, processPromptMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringMatching(/^\[The original video is available on disk at:/),
      deps,
    );
  });

  it("rejects videos over the Telegram download limit before downloading", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        file_name: "VID_huge.mp4",
        mime_type: "video/mp4",
        file_size: 21 * 1024 * 1024,
        duration: 300,
        width: 1920,
        height: 1080,
      },
    });
    const { deps, processPromptMock, downloadMock, saveVideoMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.file_too_large", { maxSizeMb: "20" }));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(saveVideoMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("reserves raw video bytes when queued while busy", async () => {
    vi.spyOn(settingsStore, "getPromptQueueEnabled").mockReturnValue(true);
    foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createVideoContext();
    const { deps, processPromptMock, downloadMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(downloadMock).toHaveBeenCalledOnce();
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.list()).toEqual([
      expect.objectContaining({ mediaBytes: 5_000_000 }),
    ]);
  });

  it("shows download error when the download fails", async () => {
    const { ctx, replyMock } = createVideoContext();
    const { deps } = createVideoDeps({
      downloadFile: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.file_download_error"));
  });

  it("returns early when the message has no video", async () => {
    const ctx = { chat: { id: 777 }, message: {} } as unknown as Context;
    const { deps, processPromptMock, downloadMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
