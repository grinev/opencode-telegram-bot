import { describe, expect, it, vi } from "vitest";

function toPlainParts(
  blocks: Array<{ text: string; fallbackText: string; source: "entities" | "plain" }>,
) {
  return blocks.map((block) => ({
    text: block.text,
    fallbackText: block.fallbackText,
    source: block.source,
  }));
}

async function loadAssistantRendering(mode: "raw" | "markdown") {
  vi.resetModules();

  const debug = vi.fn();
  const warn = vi.fn();
  const renderTelegramBlocks = vi.fn((text: string) => [
    {
      blockType: "paragraph" as const,
      mode: "full" as const,
      text: `rich:${text}`,
      fallbackText: `rich:${text}`,
      source: "plain" as const,
    },
  ]);
  const renderTelegramParts = vi.fn((text: string) => [
    {
      text: `rich:${text}`,
      entities: [{ type: "bold" as const, offset: 0, length: `rich:${text}`.length }],
      fallbackText: `rich:${text}`,
      source: "entities" as const,
    },
  ]);
  const chunkTelegramRenderedBlocks = vi.fn(
    (blocks: Array<{ text: string; fallbackText: string; source: "entities" | "plain" }>) =>
      toPlainParts(blocks),
  );

  vi.doMock("../../../src/config.js", () => ({
    config: {
      telegram: {
        token: "test-token",
        allowedUserId: 123456789,
        proxyUrl: "",
      },
      opencode: {
        apiUrl: "http://localhost:4096",
        username: "opencode",
        password: "",
        model: {
          provider: "test-provider",
          modelId: "test-model",
        },
      },
      server: {
        logLevel: "error",
      },
      bot: {
        messageFormatMode: mode,
        responseStreamThrottleMs: 500,
      },
      files: { maxFileSizeKb: 100 },
      open: { browserRoots: "" },
      stt: { apiUrl: "", apiKey: "", model: "", language: "" },
      tts: { apiUrl: "", apiKey: "", model: "", voice: "" },
    },
  }));
  vi.doMock("../../../src/utils/logger.js", () => ({
    logger: {
      debug,
      warn,
      info: vi.fn(),
      error: vi.fn(),
    },
  }));
  vi.doMock("../../../src/telegram/render/pipeline.js", () => ({
    renderTelegramBlocks,
    renderTelegramParts,
  }));
  vi.doMock("../../../src/telegram/render/chunker.js", () => ({
    chunkTelegramRenderedBlocks,
  }));

  const module = await import("../../../src/bot/utils/assistant-rendering.js");
  return {
    module,
    debug,
    warn,
    renderTelegramBlocks,
    renderTelegramParts,
    chunkTelegramRenderedBlocks,
  };
}

describe("bot/utils/assistant-rendering", () => {
  it("uses plain parts only for assistant final delivery in raw mode", async () => {
    const { module, debug, renderTelegramParts, chunkTelegramRenderedBlocks } =
      await loadAssistantRendering("raw");

    expect(module.renderAssistantFinalPartsSafe("hello raw", 50)).toEqual([
      {
        text: "hello raw",
        fallbackText: "hello raw",
        source: "plain",
      },
    ]);

    expect(renderTelegramParts).not.toHaveBeenCalled();
    expect(chunkTelegramRenderedBlocks).toHaveBeenCalledWith(
      [
        {
          blockType: "plain",
          mode: "plain",
          text: "hello raw",
          fallbackText: "hello raw",
          source: "plain",
        },
      ],
      { maxPartLength: 34 },
    );
    expect(debug).toHaveBeenCalledWith(
      "[AssistantRender] Built final assistant parts in raw mode",
      expect.objectContaining({ formatMode: "raw", partCount: 1, textLength: 9 }),
    );
  });

  it("uses plain payload only for assistant streaming in raw mode", async () => {
    const { module, debug, renderTelegramBlocks, chunkTelegramRenderedBlocks } =
      await loadAssistantRendering("raw");

    expect(module.prepareAssistantStreamingPayload("partial **text", 40)).toEqual({
      parts: [
        {
          text: "partial **text",
          fallbackText: "partial **text",
          source: "plain",
        },
      ],
    });

    expect(renderTelegramBlocks).not.toHaveBeenCalled();
    expect(chunkTelegramRenderedBlocks).toHaveBeenCalledWith(
      [
        {
          blockType: "plain",
          mode: "plain",
          text: "partial **text",
          fallbackText: "partial **text",
          source: "plain",
        },
      ],
      { maxPartLength: 24 },
    );
    expect(debug).toHaveBeenCalledWith(
      "[AssistantRender] Built streaming assistant payload in raw mode",
      expect.objectContaining({ formatMode: "raw", partCount: 1, textLength: 14 }),
    );
  });

  it("uses rich stable prefix and plain tail for streaming in markdown mode", async () => {
    const { module, debug, renderTelegramBlocks, chunkTelegramRenderedBlocks } =
      await loadAssistantRendering("markdown");

    expect(module.prepareAssistantStreamingPayload("done\n\nunfinished", 60)).toEqual({
      parts: [
        {
          text: "rich:done\n\n",
          fallbackText: "rich:done\n\n",
          source: "plain",
        },
        {
          text: "unfinished",
          fallbackText: "unfinished",
          source: "plain",
        },
      ],
    });

    expect(renderTelegramBlocks).toHaveBeenCalledWith("done\n\n");
    expect(chunkTelegramRenderedBlocks).toHaveBeenCalledWith(
      [
        {
          blockType: "paragraph",
          mode: "full",
          text: "rich:done\n\n",
          fallbackText: "rich:done\n\n",
          source: "plain",
        },
        {
          blockType: "plain",
          mode: "plain",
          text: "unfinished",
          fallbackText: "unfinished",
          source: "plain",
        },
      ],
      { maxPartLength: 60 },
    );
    expect(debug).toHaveBeenCalledWith(
      "[AssistantRender] Built streaming assistant payload in entities mode",
      expect.objectContaining({
        formatMode: "entities",
        stableBoundary: 6,
        tailLength: 10,
        partCount: 2,
      }),
    );
  });

  it("falls back to plain parts when markdown final rendering fails", async () => {
    const { module, warn, renderTelegramParts } = await loadAssistantRendering("markdown");
    renderTelegramParts.mockImplementationOnce(() => {
      throw new Error("render failed");
    });

    expect(module.renderAssistantFinalPartsSafe("final text", 80)).toEqual([
      {
        text: "final text",
        fallbackText: "final text",
        source: "plain",
      },
    ]);

    expect(warn).toHaveBeenCalledWith(
      "[AssistantRender] Part rendering failed, falling back to plain text parts",
      expect.any(Error),
    );
  });
});
