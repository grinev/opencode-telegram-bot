import { describe, expect, it, vi } from "vitest";
import { defined } from "../../helpers/defined.js";

async function loadAssistantRendering(mode: "raw" | "markdown") {
  vi.resetModules();

  const debug = vi.fn();
  const warn = vi.fn();

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

  const module = await import("../../../src/bot/messages/assistant-rendering.js");
  return { module, debug, warn };
}

describe("bot/messages/assistant-rendering", () => {
  it("omits images in the unstable streaming tail, but keeps a final image-only reply", async () => {
    const { module } = await loadAssistantRendering("markdown");
    expect(module.prepareAssistantStreamingPayload("![name](a.png)")).toBeNull();
    const payload = module.prepareAssistantStreamingPayload("before ![name](a.png) after");
    expect(JSON.stringify(payload)).not.toContain("![name]");
    expect(module.renderAssistantFinalPartsSafe("![](a.png)", "/remote/project")[0]).toMatchObject({
      imageDirectory: "/remote/project",
      blocks: [{ type: "photo" }],
    });
  });
  it("uses plain parts only for assistant final delivery in raw mode", async () => {
    const { module, debug } = await loadAssistantRendering("raw");

    expect(module.renderAssistantFinalPartsSafe("hello **raw**")).toEqual([
      {
        blocks: [],
        fallbackText: "hello **raw**",
        source: "plain",
      },
    ]);

    expect(debug).toHaveBeenCalledWith(
      "[AssistantRender] Built final assistant parts in raw mode",
      expect.objectContaining({ formatMode: "raw", partCount: 1 }),
    );
  });

  it("splits raw mode output on the plain text budget", async () => {
    const { module } = await loadAssistantRendering("raw");

    const parts = module.renderAssistantFinalPartsSafe("x".repeat(9000));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.source).toBe("plain");
      expect(part.fallbackText.length).toBeLessThanOrEqual(4096);
    }
  });

  it("uses plain payload only for assistant streaming in raw mode", async () => {
    const { module, debug } = await loadAssistantRendering("raw");

    expect(module.prepareAssistantStreamingPayload("partial **text")).toEqual({
      parts: [
        {
          blocks: [],
          fallbackText: "partial **text",
          source: "plain",
        },
      ],
    });

    expect(debug).toHaveBeenCalledWith(
      "[AssistantRender] Built streaming assistant payload in raw mode",
      expect.objectContaining({ formatMode: "raw", partCount: 1 }),
    );
  });

  it("renders the whole final reply as one native part in markdown mode", async () => {
    const { module } = await loadAssistantRendering("markdown");

    const parts = module.renderAssistantFinalPartsSafe("# Title\n\nSome **bold** text");

    expect(parts).toHaveLength(1);
    expect(defined(parts[0]).source).toBe("blocks");
    expect(defined(parts[0]).blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
  });

  it("parses the stable prefix and keeps the streaming tail literal", async () => {
    const { module } = await loadAssistantRendering("markdown");

    const payload = module.prepareAssistantStreamingPayload("## Done\n\n| unfinished |");

    expect(payload?.parts).toHaveLength(1);
    expect(defined(payload?.parts[0]).blocks).toEqual([
      { type: "heading", text: "Done", size: 2 },
      { type: "paragraph", text: "| unfinished |" },
    ]);
  });

  it("treats text without a completed block as an entirely literal tail", async () => {
    const { module } = await loadAssistantRendering("markdown");

    const payload = module.prepareAssistantStreamingPayload("# still typing");

    expect(defined(payload?.parts[0]).blocks).toEqual([
      { type: "paragraph", text: "# still typing" },
    ]);
  });

  it("returns no payload for empty text", async () => {
    const { module } = await loadAssistantRendering("markdown");

    expect(module.prepareAssistantStreamingPayload("")).toBeNull();
    expect(module.renderAssistantFinalPartsSafe("")).toEqual([]);
  });

  it("exposes streaming blocks for reuse by the thinking renderer", async () => {
    const { module } = await loadAssistantRendering("markdown");

    expect(module.buildStreamingBlocks("- one\n- two\n\ntail")).toEqual([
      {
        block: {
          type: "list",
          items: [
            { blocks: [{ type: "paragraph", text: "one" }] },
            { blocks: [{ type: "paragraph", text: "two" }] },
          ],
        },
        plainText: "- one\n- two",
      },
      { block: { type: "paragraph", text: "tail" }, plainText: "tail" },
    ]);
  });
});
